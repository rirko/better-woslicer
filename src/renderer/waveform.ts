/**
 * Timeline rendering: ruler, overview, waveform lanes, grid/measure lines,
 * slice bars, selection, markers, cue heads and ghost previews.
 *
 * Canvas layering (bottom -> top): waveform+grid+markers (wave canvas),
 * then playhead/selection-drag/ghosts (overlay canvas, animated).
 */

import { markerTicks } from "../core/wos.js";
import { MEASURE_TICKS, MAX_TICKS, tickToSampleExport } from "../core/timebase.js";
import { peakRange } from "../core/peaks.js";
import { Store } from "./store.js";

export const RULER_HEIGHT = 28;
export const OVERVIEW_HEIGHT = 36;

const COLORS = {
  app: "#0E1013",
  panel: "#14171B",
  surface1: "#1A1E23",
  surface2: "#22272D",
  surface3: "#2B3138",
  text3: "#8D97A1",
  text2: "#B7BEC6",
  wave: "#5FA79D",
  waveBright: "#8FE3D6",
  playhead: "#F5F7FA",
  selection: "#7FB3FF",
  accent: "#F2B24C",
  cue: "#58C7E8",
  danger: "#FF6B6B",
};

function setupCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export class TimelineView {
  constructor(
    private store: Store,
    private ruler: HTMLCanvasElement,
    private wave: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    private overview: HTMLCanvasElement
  ) {}

  tickToX(tick: number, scrollTick: number, pxPerTick: number): number {
    return (tick - scrollTick) * pxPerTick;
  }

  xToTick(x: number, scrollTick: number, pxPerTick: number): number {
    return scrollTick + x / pxPerTick;
  }

  drawRuler(): void {
    const width = this.ruler.clientWidth;
    const ctx = setupCanvas(this.ruler, width, RULER_HEIGHT);
    const { scrollTick, pxPerTick } = this.store.state;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    // Choose a tick spacing that yields >= 60px between labels.
    const candidates = [1, 2, 4, 8, 12, 16, 24, 32, 48, 96, 192, 384, 768, 1536, 3072, 6144, 12288, 24576];
    let spacing = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (c * pxPerTick >= 60) {
        spacing = c;
        break;
      }
    }

    ctx.font = "10px Consolas, monospace";
    ctx.textBaseline = "middle";
    const first = Math.floor(scrollTick / spacing) * spacing;
    for (let tick = first; tick <= scrollTick + width / pxPerTick; tick += spacing) {
      if (tick < 0 || tick > MAX_TICKS) continue;
      const x = this.tickToX(tick, scrollTick, pxPerTick);
      const isMeasure = tick % MEASURE_TICKS === 0;
      ctx.strokeStyle = isMeasure ? COLORS.text2 : COLORS.text3;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, isMeasure ? 10 : 18);
      ctx.lineTo(x + 0.5, RULER_HEIGHT);
      ctx.stroke();
      if (isMeasure) {
        ctx.fillStyle = COLORS.text2;
        ctx.fillText(String(Math.floor(tick / MEASURE_TICKS) + 1).padStart(3, "0"), x + 3, 12);
      }
    }
  }

  drawWave(): void {
    const wrap = this.wave.parentElement as HTMLElement;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const ctx = setupCanvas(this.wave, width, height);
    const s = this.store.state;
    ctx.fillStyle = COLORS.app;
    ctx.fillRect(0, 0, width, height);
    if (!s.source || !s.peaks) return;

    const laneHeight = height / s.source.channels;
    const ticks = markerTicks(s.doc.markers);
    const { scrollTick, pxPerTick } = s;
    const fromTick = scrollTick;
    const toTick = scrollTick + width / pxPerTick;

    // Slice bars: alternate surface tint per slice.
    ctx.strokeStyle = COLORS.surface3;
    for (const t of ticks) {
      if (t < fromTick - MEASURE_TICKS || t > toTick) continue;
      const x = this.tickToX(t, scrollTick, pxPerTick);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }

    for (let c = 0; c < s.source.channels; c++) {
      const laneTop = c * laneHeight;
      const mid = laneTop + laneHeight / 2;
      const half = laneHeight / 2 - 4;

      ctx.fillStyle = COLORS.surface1;
      ctx.fillRect(0, laneTop, width, laneHeight);
      ctx.strokeStyle = COLORS.surface3;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();

      // Grid lines per measure / grid division.
      const measureStart = Math.floor(fromTick / MEASURE_TICKS) * MEASURE_TICKS;
      for (let tick = measureStart; tick <= toTick + MEASURE_TICKS; tick += MEASURE_TICKS) {
        if (tick < 0 || tick > MAX_TICKS) continue;
        const x = this.tickToX(tick, scrollTick, pxPerTick);
        ctx.strokeStyle = COLORS.surface2;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, laneTop);
        ctx.lineTo(x + 0.5, laneTop + laneHeight);
        ctx.stroke();
        if (pxPerTick * s.grid > 14) {
          for (let g = s.grid; g < MEASURE_TICKS; g += s.grid) {
            const gx = this.tickToX(tick + g, scrollTick, pxPerTick);
            ctx.strokeStyle = COLORS.surface1;
            ctx.beginPath();
            ctx.moveTo(gx + 0.5, laneTop);
            ctx.lineTo(gx + 0.5, laneTop + laneHeight);
            ctx.stroke();
          }
        }
      }

      // Waveform from the peak cache (never rescans the source).
      // The view axis is ticks; frames are derived through the time base so
      // the waveform stays aligned with markers at any BPM/shift.
      const step = Math.max(1, Math.round(1 / pxPerTick));
      const timeBase = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate };
      ctx.fillStyle = c === 0 ? COLORS.wave : COLORS.waveBright;
      for (let x = 0; x < width; x += step) {
        const t0 = this.xToTick(x, scrollTick, pxPerTick);
        const t1 = this.xToTick(x + step, scrollTick, pxPerTick);
        const f0 = tickToSampleExport(Math.floor(t0), timeBase);
        const f1 = tickToSampleExport(Math.max(Math.floor(t0) + 1, Math.ceil(t1)), timeBase);
        const range = peakRange(s.peaks, s.source.length, f0, Math.max(f0 + 1, f1));
        const yMin = mid - (range.max / 32768) * half;
        const yMax = mid - (range.min / 32768) * half;
        ctx.fillRect(x, yMin, Math.max(1, step), Math.max(1, yMax - yMin));
      }
    }

    // Markers on top.
    for (const t of ticks) {
      if (t < fromTick || t > toTick) continue;
      const x = this.tickToX(t, scrollTick, pxPerTick);
      const selected = s.selectedTicks.includes(t);
      ctx.strokeStyle = selected ? COLORS.selection : COLORS.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
      ctx.fillStyle = selected ? COLORS.selection : COLORS.accent;
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 4, 0);
      ctx.lineTo(x, 6);
      ctx.closePath();
      ctx.fill();
    }

    // Persistent selection rectangle.
    if (s.selectionStartTick !== null && s.selectionEndTick !== null) {
      const a = Math.min(s.selectionStartTick, s.selectionEndTick);
      const b = Math.max(s.selectionStartTick, s.selectionEndTick);
      const x0 = this.tickToX(a, scrollTick, pxPerTick);
      const x1 = this.tickToX(b, scrollTick, pxPerTick);
      ctx.fillStyle = "rgba(127, 179, 255, 0.12)";
      ctx.fillRect(x0, 0, x1 - x0, height);
      ctx.strokeStyle = COLORS.selection;
      ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0, height - 1);
    }
  }

  /** Animated overlay: playhead, in-progress box selection, ghost previews. */
  drawOverlay(ghost?: { ticks: number[]; delta: number }): void {
    const wrap = this.overlay.parentElement as HTMLElement;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const ctx = setupCanvas(this.overlay, width, height);
    const s = this.store.state;
    ctx.clearRect(0, 0, width, height);
    const { scrollTick, pxPerTick } = s;

    // Ghost preview while dragging markers.
    if (ghost && ghost.delta !== 0) {
      ctx.fillStyle = "rgba(143, 227, 214, 0.25)";
      for (const t of ghost.ticks) {
        const x = this.tickToX(t + ghost.delta, scrollTick, pxPerTick);
        ctx.fillRect(x - 1, 0, 2, height);
      }
    }

    // Playhead.
    if (s.source) {
      const base = s.doc.shift;
      const tickAtPlayhead =
        ((s.playheadSample / (s.source.sampleRate * 5)) * 4 * s.doc.bpm - base);
      const x = this.tickToX(tickAtPlayhead, scrollTick, pxPerTick);
      if (x >= -2 && x <= width + 2) {
        ctx.strokeStyle = COLORS.playhead;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
        ctx.fillStyle = COLORS.playhead;
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 8);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  drawOverview(): void {
    const width = this.overview.clientWidth;
    const ctx = setupCanvas(this.overview, width, OVERVIEW_HEIGHT);
    const s = this.store.state;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, width, OVERVIEW_HEIGHT);
    if (!s.source || !s.peaks) return;

    const pxPerTickOverview = width / MAX_TICKS;
    const lanes = s.source.channels;
    const laneHeight = OVERVIEW_HEIGHT / lanes;
    for (let c = 0; c < lanes; c++) {
      const mid = c * laneHeight + laneHeight / 2;
      const half = laneHeight / 2 - 2;
      ctx.fillStyle = COLORS.wave;
      for (let x = 0; x < width; x += 2) {
        const f0 = (x / width) * s.source.length;
        const f1 = ((x + 2) / width) * s.source.length;
        const range = peakRange(s.peaks, s.source.length, f0, Math.max(f0 + 1, f1));
        const yMin = mid - (range.max / 32768) * half;
        const yMax = mid - (range.min / 32768) * half;
        ctx.fillRect(x, yMin, 2, Math.max(1, yMax - yMin));
      }
    }

    // Viewport indicator.
    const viewX = this.store.state.scrollTick * pxPerTickOverview;
    const viewW = (this.wave.clientWidth / this.store.state.pxPerTick) * pxPerTickOverview;
    ctx.fillStyle = "rgba(242, 178, 76, 0.18)";
    ctx.fillRect(viewX, 0, Math.max(2, viewW), OVERVIEW_HEIGHT);
    ctx.strokeStyle = COLORS.accent;
    ctx.strokeRect(viewX + 0.5, 0.5, Math.max(2, viewW), OVERVIEW_HEIGHT - 1);
  }
}
