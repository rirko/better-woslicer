/**
 * Timeline rendering: ruler, overview, waveform lanes, grid/measure lines,
 * slice bars, selection, markers, cue heads and ghost previews.
 *
 * Canvas layering (bottom -> top): waveform+grid+markers (wave canvas),
 * then playhead/selection-drag/ghosts (overlay canvas, animated).
 */

import { markerTicks } from "../core/wos.js";
import { MEASURE_TICKS, MAX_TICKS, tickToSampleExport } from "../core/timebase.js";
import { peakRange, PeakCache } from "../core/peaks.js";
import { BAND_DRAW_MIN_ABS } from "../core/bands.js";
import { gridLineTicks, gridStepTicks, measureLabelStep } from "../core/gridlines.js";
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
  /* Band overlay palette (frozen spec: violet / green / pink). */
  bandLow: "rgba(177, 140, 255, 0.85)",
  bandMid: "rgba(168, 212, 106, 0.75)",
  bandHigh: "rgba(240, 143, 180, 0.85)",
  waveDim: "rgba(95, 167, 157, 0.35)",
  waveBrightDim: "rgba(143, 227, 214, 0.35)",
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

  /**
   * Live viewport width, measured every draw. Deliberately NOT taken from
   * each canvas's own clientWidth: setupCanvas pins that with an inline
   * style, so a canvas measuring itself would stay at its previous size
   * after a window resize (the "right side stays black" bug). Ruler, wave,
   * overlay and overview all span the same column as the wave wrap.
   */
  private viewportWidth(): number {
    return (this.wave.parentElement as HTMLElement).clientWidth;
  }

  drawRuler(): void {
    const width = this.viewportWidth();
    const ctx = setupCanvas(this.ruler, width, RULER_HEIGHT);
    const s = this.store.state;
    const { scrollTick, pxPerTick } = s;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    ctx.font = "10px Consolas, monospace";
    ctx.textBaseline = "middle";

    // Ruler lines are exactly the grid/snap positions (shared gridLineTicks):
    // grid multiples, measure lines highlighted; below 2px per cell only the
    // measure lines remain. Labels may skip measures (interval doubling) but
    // never leave the real measure positions.
    const labelStep = measureLabelStep(pxPerTick * MEASURE_TICKS);
    const toTick = scrollTick + width / pxPerTick;
    for (const line of gridLineTicks(scrollTick, toTick, gridStepTicks(s.grid), pxPerTick)) {
      const x = this.tickToX(line.tick, scrollTick, pxPerTick);
      ctx.strokeStyle = line.isMeasure ? COLORS.text2 : COLORS.text3;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, line.isMeasure ? 10 : 18);
      ctx.lineTo(x + 0.5, RULER_HEIGHT);
      ctx.stroke();
      if (line.isMeasure) {
        const measure = line.tick / MEASURE_TICKS;
        if (measure % labelStep === 0) {
          ctx.fillStyle = COLORS.text2;
          ctx.fillText(String(measure + 1).padStart(3, "0"), x + 3, 12);
        }
      }
    }
  }

  drawWave(): void {
    const width = this.viewportWidth();
    const height = (this.wave.parentElement as HTMLElement).clientHeight;
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

      // Grid lines: the exact same tick set the ruler draws and the snap
      // resolves to — grid multiples only, collapsing to measure-only below
      // 2px per cell. Ruler, grid and snap therefore stay pixel-identical
      // at every zoom.
      for (const line of gridLineTicks(fromTick, toTick, gridStepTicks(s.grid), pxPerTick)) {
        const x = this.tickToX(line.tick, scrollTick, pxPerTick);
        ctx.strokeStyle = line.isMeasure ? COLORS.surface2 : COLORS.surface1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, laneTop);
        ctx.lineTo(x + 0.5, laneTop + laneHeight);
        ctx.stroke();
      }

      // Waveform from the peak cache (never rescans the source).
      // The view axis is ticks; frames are derived through the time base so
      // the waveform stays aligned with markers at any BPM/shift.
      const step = Math.max(1, Math.round(1 / pxPerTick));
      const timeBase = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate };
      const bandsOn = s.bandsVisible && s.bandAnalysis !== null;
      ctx.fillStyle = bandsOn
        ? c === 0
          ? COLORS.waveDim
          : COLORS.waveBrightDim
        : c === 0
          ? COLORS.wave
          : COLORS.waveBright;
      for (let x = 0; x < width; x += step) {
        const t0 = this.xToTick(x, scrollTick, pxPerTick);
        const t1 = this.xToTick(x + step, scrollTick, pxPerTick);
        const f0 = tickToSampleExport(Math.floor(t0), timeBase);
        const f1 = tickToSampleExport(Math.max(Math.floor(t0) + 1, Math.ceil(t1)), timeBase);
        // Outside the source: draw nothing (otherwise the 1px minimum-height
        // fill paints a fake zero line past the end of the audio).
        if (f1 <= 0 || f0 >= s.source.length) continue;
        const range = peakRange(s.peaks, s.source.length, f0, Math.max(f0 + 1, f1));
        const yMin = mid - (range.max / 32768) * half;
        const yMax = mid - (range.min / 32768) * half;
        ctx.fillRect(x, yMin, Math.max(1, step), Math.max(1, yMax - yMin));
      }

      // Band overlay: envelope polylines for low / mid / high, drawn in the
      // same lane (never a separate track). Marker/selection/playhead stay on
      // top because this block runs before those layers.
      if (bandsOn) {
        const analysis = s.bandAnalysis!;
        this.drawBandEnvelope(ctx, analysis.low.peaks[c], COLORS.bandLow, 1, [], width, mid, half, scrollTick, pxPerTick, timeBase, s.source.length, step);
        this.drawBandEnvelope(ctx, analysis.mid.peaks[c], COLORS.bandMid, 1, [4, 2], width, mid, half, scrollTick, pxPerTick, timeBase, s.source.length, step);
        this.drawBandEnvelope(ctx, analysis.high.peaks[c], COLORS.bandHigh, 1.25, [], width, mid, half, scrollTick, pxPerTick, timeBase, s.source.length, step);
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

  /**
   * One band's envelope: two polylines (upper + lower) over the lane, with
   * gaps where the band sits below -60 dBFS so three bands never merge into a
   * single blob on the zero line.
   */
  private drawBandEnvelope(
    ctx: CanvasRenderingContext2D,
    peaks: PeakCache,
    color: string,
    lineWidth: number,
    dash: number[],
    width: number,
    mid: number,
    half: number,
    scrollTick: number,
    pxPerTick: number,
    timeBase: { bpm: number; shift: number; sampleRate: number },
    sourceLength: number,
    step: number
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    for (const upper of [true, false]) {
      ctx.beginPath();
      let drawing = false;
      for (let x = 0; x <= width; x += step) {
        const t0 = this.xToTick(x, scrollTick, pxPerTick);
        const t1 = this.xToTick(x + step, scrollTick, pxPerTick);
        const f0 = tickToSampleExport(Math.floor(t0), timeBase);
        const f1 = tickToSampleExport(Math.max(Math.floor(t0) + 1, Math.ceil(t1)), timeBase);
        const range = peakRange(peaks, sourceLength, f0, Math.max(f0 + 1, f1));
        const loud = Math.max(Math.abs(range.min), Math.abs(range.max)) >= BAND_DRAW_MIN_ABS;
        if (!loud) {
          drawing = false;
          continue;
        }
        const value = upper ? range.max : range.min;
        const y = mid - (value / 32768) * half;
        if (drawing) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          drawing = true;
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Animated overlay: playhead, in-progress box selection, ghost previews. */
  drawOverlay(ghost?: { ticks: number[]; delta: number }): void {    const width = this.viewportWidth();
    const height = (this.overlay.parentElement as HTMLElement).clientHeight;
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
    const width = this.viewportWidth();
    const ctx = setupCanvas(this.overview, width, OVERVIEW_HEIGHT);
    const s = this.store.state;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, width, OVERVIEW_HEIGHT);
    if (!s.source || !s.peaks) return;

    // The overview uses the SAME axis as the main timeline: ticks 0..MAX, not
    // audio 0..length. Drawing it in audio percentages used to stretch the
    // file across the full strip, so the viewport rectangle (which is in tick
    // space) pointed at the wrong audio — "the preview does not match".
    const pxPerTickOverview = width / MAX_TICKS;
    const lanes = s.source.channels;
    const laneHeight = OVERVIEW_HEIGHT / lanes;
    const timeBase = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate };
    for (let c = 0; c < lanes; c++) {
      const mid = c * laneHeight + laneHeight / 2;
      const half = laneHeight / 2 - 2;
      ctx.fillStyle = COLORS.wave;
      for (let x = 0; x < width; x += 2) {
        const t0 = (x / width) * MAX_TICKS;
        const t1 = ((x + 2) / width) * MAX_TICKS;
        const f0 = tickToSampleExport(Math.floor(t0), timeBase);
        const f1 = tickToSampleExport(Math.max(Math.floor(t0) + 1, Math.ceil(t1)), timeBase);
        if (f1 <= 0 || f0 >= s.source.length) continue;
        const range = peakRange(s.peaks, s.source.length, f0, Math.max(f0 + 1, f1));
        const yMin = mid - (range.max / 32768) * half;
        const yMax = mid - (range.min / 32768) * half;
        ctx.fillRect(x, yMin, 2, Math.max(1, yMax - yMin));
      }
    }

    // Viewport indicator (tick space — now the same space as the waveform).
    const viewX = s.scrollTick * pxPerTickOverview;
    const viewW = (width / s.pxPerTick) * pxPerTickOverview;
    ctx.fillStyle = "rgba(242, 178, 76, 0.18)";
    ctx.fillRect(viewX, 0, Math.max(2, viewW), OVERVIEW_HEIGHT);
    ctx.strokeStyle = COLORS.accent;
    ctx.strokeRect(viewX + 0.5, 0.5, Math.max(2, viewW), OVERVIEW_HEIGHT - 1);
  }
}
