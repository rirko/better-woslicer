import type { EditorStore } from '../slicing/editor-store';
import type { Palette } from '../ui/palette';
import { MAX_TICKS, MEASURE_TICKS } from '../core/timebase';
import { gridLineTicks, gridStepTicks, measureLabelStep } from '../core/gridlines';
import { peakRange } from '../core/peaks';
import { drawBandEnvelope, drawWaveLane, sampleToTick, tickToFrame } from './waveform';

export const RULER_HEIGHT = 28;
export const OVERVIEW_HEIGHT = 36;
export type TimelineSnapshot = Pick<EditorStore, 'doc' | 'ticks' | 'previewTicks' | 'source' | 'peaks' | 'grid' | 'scrollTick' | 'pxPerTick' | 'rmsVisible' | 'bandsVisible' | 'bandAnalysis' | 'selectedTicks' | 'selectionStartTick' | 'selectionEndTick' | 'cursorTick' | 'playheadSample'>;
export interface Ghost { ticks: readonly number[]; delta: number }
export interface CanvasSize { width: number; height: number; dpr: number }

export function setupCanvas(canvas: HTMLCanvasElement, { width, height, dpr }: CanvasSize): CanvasRenderingContext2D | null {
  const pixelWidth = Math.max(1, Math.floor(width * dpr)), pixelHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}
function vertical(context: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
  context.beginPath(); context.moveTo(x + .5, top); context.lineTo(x + .5, bottom); context.stroke();
}
function hatch(context: CanvasRenderingContext2D, x: number, width: number, height: number, palette: Readonly<Palette>): void {
  if (x >= width) return;
  const left = Math.max(0, x);
  context.save(); context.beginPath(); context.rect(left, 0, width - left, height); context.clip();
  context.fillStyle = palette.panel; context.fillRect(left, 0, width - left, height);
  context.strokeStyle = palette.hatch; context.lineWidth = 2; context.beginPath();
  for (let offset = left - height; offset < width; offset += 12) {
    context.moveTo(offset, height); context.lineTo(offset + height, 0);
  }
  context.stroke(); context.restore(); context.strokeStyle = palette.danger;
  vertical(context, Math.floor(x), 0, height);
}

export function drawRuler(context: CanvasRenderingContext2D, state: TimelineSnapshot, width: number, palette: Readonly<Palette>): void {
  context.fillStyle = palette.panel; context.fillRect(0, 0, width, RULER_HEIGHT);
  context.font = '10px Consolas, monospace'; context.textBaseline = 'middle'; context.lineWidth = 1;
  const labelStep = measureLabelStep(state.pxPerTick * MEASURE_TICKS);
  for (const line of gridLineTicks(state.scrollTick, state.scrollTick + width / state.pxPerTick, gridStepTicks(state.grid), state.pxPerTick)) {
    const x = (line.tick - state.scrollTick) * state.pxPerTick;
    context.strokeStyle = line.isMeasure ? palette.text2 : palette.text3;
    vertical(context, x, line.isMeasure ? 10 : 18, RULER_HEIGHT);
    const measure = line.tick / MEASURE_TICKS;
    if (line.isMeasure && measure % labelStep === 0) {
      context.fillStyle = palette.text2; context.fillText(String(measure + 1).padStart(3, '0'), x + 3, 12);
    }
  }
}

export function drawTimeline(context: CanvasRenderingContext2D, state: TimelineSnapshot, size: CanvasSize, palette: Readonly<Palette>): void {
  const { width, height, dpr } = size;
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.surface1; context.fillRect(0, 0, width, height);
  context.lineWidth = 1;
  const lanes = state.source?.channels ?? 1, laneHeight = height / lanes;
  const toTick = state.scrollTick + width / state.pxPerTick;
  for (const line of gridLineTicks(state.scrollTick, toTick, gridStepTicks(state.grid), state.pxPerTick)) {
    context.strokeStyle = line.isMeasure ? palette.surface3 : palette.surface2;
    vertical(context, (line.tick - state.scrollTick) * state.pxPerTick, 0, height);
  }
  const source = state.source;
  if (source) {
    const timeBase = { bpm: state.doc.bpm, shift: state.doc.shift, sampleRate: source.sampleRate };
    hatch(context, (sampleToTick(source.length, timeBase) - state.scrollTick) * state.pxPerTick, width, height, palette);
    const view = { width, dpr, scrollTick: state.scrollTick, pxPerTick: state.pxPerTick, timeBase };
    const bands = state.bandsVisible ? state.bandAnalysis : null;
    for (let lane = 0; lane < lanes; lane++) {
      const mid = laneHeight * (lane + .5), half = Math.max(0, laneHeight / 2 - 4);
      context.strokeStyle = palette.surface3;
      context.beginPath(); context.moveTo(0, mid + .5); context.lineTo(width, mid + .5); context.stroke();
      const data = source.data[lane];
      if (data && state.peaks) drawWaveLane(context, view, data, state.peaks, mid, half, {
        outer: bands ? (lane ? palette.waveBrightDim : palette.waveDim) : (lane ? palette.waveBright : palette.wave),
        rms: bands ? (lane ? palette.waveRmsBrightDim : palette.waveRmsDim) : (lane ? palette.waveRmsBright : palette.waveRms),
      }, state.rmsVisible);
      if (bands) {
        const low = bands.low.peaks[lane], middle = bands.mid.peaks[lane], high = bands.high.peaks[lane];
        if (low) drawBandEnvelope(context, view, low, source.length, mid, half, palette.bandLow, [], 1);
        if (middle) drawBandEnvelope(context, view, middle, source.length, mid, half, palette.bandMid, [4, 2], 1);
        if (high) drawBandEnvelope(context, view, high, source.length, mid, half, palette.bandHigh, [], 1.25);
      }
    }
  }
  context.lineWidth = 1;
  for (const tick of state.previewTicks ?? state.ticks) {
    if (tick < state.scrollTick || tick > toTick) continue;
    const x = (tick - state.scrollTick) * state.pxPerTick;
    context.strokeStyle = context.fillStyle = state.selectedTicks.includes(tick) ? palette.selection : palette.accent;
    vertical(context, x, 0, height);
    context.beginPath(); context.moveTo(x - 4, 0); context.lineTo(x + 4, 0); context.lineTo(x, 6); context.closePath(); context.fill();
  }
  if (state.selectionStartTick !== null && state.selectionEndTick !== null) {
    const first = Math.min(state.selectionStartTick, state.selectionEndTick), last = Math.max(state.selectionStartTick, state.selectionEndTick);
    const x = (first - state.scrollTick) * state.pxPerTick, span = (last - first) * state.pxPerTick;
    context.fillStyle = palette.selectionFill; context.fillRect(x, 0, span, height);
    context.strokeStyle = palette.selection; context.strokeRect(x + .5, .5, span, height - 1);
  }
}

export function drawOverlay(context: CanvasRenderingContext2D, state: TimelineSnapshot, size: CanvasSize, palette: Readonly<Palette>, ghost?: Ghost): void {
  const { width, height } = size;
  context.clearRect(0, 0, width, height); context.lineWidth = 1;
  if (ghost && ghost.delta !== 0) {
    context.fillStyle = palette.ghost;
    for (const tick of ghost.ticks) context.fillRect((tick + ghost.delta - state.scrollTick) * state.pxPerTick - 1, 0, 2, height);
  }
  if (state.source) {
    const tick = sampleToTick(state.playheadSample, { bpm: state.doc.bpm, shift: state.doc.shift, sampleRate: state.source.sampleRate });
    const x = (tick - state.scrollTick) * state.pxPerTick;
    if (x >= -2 && x <= width + 2) {
      context.strokeStyle = context.fillStyle = palette.playhead; vertical(context, x, 0, height);
      context.beginPath(); context.moveTo(x - 5, 0); context.lineTo(x + 5, 0); context.lineTo(x, 8); context.closePath(); context.fill();
    }
  }
  context.save(); context.strokeStyle = palette.accent; context.setLineDash([4, 4]);
  vertical(context, (state.cursorTick - state.scrollTick) * state.pxPerTick, 0, height); context.restore();
}

export function drawOverview(context: CanvasRenderingContext2D, state: TimelineSnapshot, width: number, palette: Readonly<Palette>): void {
  context.fillStyle = palette.panel; context.fillRect(0, 0, width, OVERVIEW_HEIGHT); context.lineWidth = 1;
  const source = state.source, cache = state.peaks;
  if (source && cache) {
    const base = { bpm: state.doc.bpm, shift: state.doc.shift, sampleRate: source.sampleRate };
    const laneHeight = OVERVIEW_HEIGHT / source.channels;
    context.fillStyle = palette.wave;
    for (let lane = 0; lane < source.channels; lane++) {
      for (let x = 0; x < width; x += 2) {
        const first = tickToFrame(x / width * MAX_TICKS, base), last = tickToFrame((x + 2) / width * MAX_TICKS, base);
        if (last <= 0 || first >= source.length) continue;
        const range = peakRange(cache, source.length, first, last);
        const middle = laneHeight * (lane + .5), half = laneHeight / 2 - 2;
        const top = middle - range.max / 32768 * half, bottom = middle - range.min / 32768 * half;
        context.fillRect(x, top, 2, Math.max(1, bottom - top));
      }
    }
    hatch(context, sampleToTick(source.length, base) / MAX_TICKS * width, width, OVERVIEW_HEIGHT, palette);
  }
  const left = state.scrollTick / MAX_TICKS * width, span = Math.max(2, width / state.pxPerTick / MAX_TICKS * width);
  context.fillStyle = palette.viewportFill; context.fillRect(left, 0, span, OVERVIEW_HEIGHT);
  context.strokeStyle = palette.accent; context.strokeRect(left + .5, .5, span, OVERVIEW_HEIGHT - 1);
}
