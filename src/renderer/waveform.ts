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
  waveRms: "#2E5450",
  waveRmsBright: "#456E68",
  waveRmsDim: "rgba(46, 84, 80, 0.4)",
  waveRmsBrightDim: "rgba(69, 110, 104, 0.4)",
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
    // The timeline is pure tick space and stays editable with no source: the
    // lane scaffolding, grid lines and slice bars must draw so markers placed
    // with Z or a paint drag are visible before any audio is loaded. Only the
    // waveform and band envelopes need a source (guard inside the lane loop).
    const lanes = s.source ? s.source.channels : 1;
    const laneHeight = height / lanes;
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

    for (let c = 0; c < lanes; c++) {
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
      if (!s.source || !s.peaks) continue; // audio passes only; lanes drew above
      const timeBase = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate };
      const endTick = (s.source.length * timeBase.bpm * 4) / (timeBase.sampleRate * 5) - timeBase.shift;
      const endX = this.tickToX(endTick, scrollTick, pxPerTick);
      if (endX < width) {
        // No-audio region: hatched so the song's extent is obvious even when
        // the ending is quiet (the waveform alone does not show it). The
        // boundary line is danger-red: cutting past it is illegal.
        ctx.fillStyle = this.stripePattern(ctx);
        ctx.fillRect(Math.max(0, endX), laneTop, width - Math.max(0, endX), laneHeight);
        ctx.strokeStyle = COLORS.danger;
        ctx.beginPath();
        ctx.moveTo(Math.floor(endX) + 0.5, laneTop);
        ctx.lineTo(Math.floor(endX) + 0.5, laneTop + laneHeight);
        ctx.stroke();
      }
      const bandsOn = s.bandsVisible && s.bandAnalysis !== null;
      const outerColor = bandsOn
        ? c === 0
          ? COLORS.waveDim
          : COLORS.waveBrightDim
        : c === 0
          ? COLORS.wave
          : COLORS.waveBright;
      const innerColor = bandsOn
        ? c === 0
          ? COLORS.waveRmsDim
          : COLORS.waveRmsBrightDim
        : c === 0
          ? COLORS.waveRms
          : COLORS.waveRmsBright;

      // Per-pixel two-tone rendering (the classic DAW style): the min/max
      // envelope in the wave color with the RMS band darker inside it, so
      // dense audio shows its envelope instead of a solid block.
      //
      // The columns are DEVICE pixels (the context is reset to identity for
      // this pass): on high-DPI screens a CSS pixel is dpr device pixels, so
      // CSS-px columns would render as 2px+ grains.
      //
      // One shared cache level per view: the widest level whose buckets are
      // at most ~2x the frames a single device column covers — every column
      // then merges only a few buckets, and a full repaint stays in
      // sub-millisecond territory at any zoom.
      const dpr = window.devicePixelRatio || 1;
      const deviceWidth = ctx.canvas.width;
      const fromFrame = tickToSampleExport(Math.floor(fromTick), timeBase);
      const toFrame = tickToSampleExport(Math.ceil(toTick), timeBase);
      // The regime thresholds compare the TRUE per-column frame count, from
      // the continuous view span: fromFrame/toFrame quantize the view to
      // whole ticks (floor/ceil), and a sub-tick view at deep zoom would
      // stay near 0.5 frames per column no matter how far in we go.
      const framesInView = ((toTick - fromTick) * timeBase.sampleRate * 5) / (timeBase.bpm * 4);
      const framesPerColumn = framesInView / deviceWidth;
      const baseBucket = s.peaks.levels[0].framesPerBucket;
      // When a column covers fewer frames than the finest cache bucket, the
      // cache is coarser than the view: read the raw samples directly (the
      // visible range at that zoom is only a few thousand frames).
      const sampleLevel = framesPerColumn < baseBucket;
      // Sample-visible: stems render once a sample spans at least ~3 CSS px
      // (Audacity's dot/point threshold) — below that the samples crowd into
      // a solid mass and the connected curve is the readable rendering.
      // framesPerColumn counts device columns, so the CSS-px spacing brings
      // in the dpr factor.
      const sampleStems = sampleLevel && framesPerColumn * dpr <= 1 / 3;
      // Between the stem view and the envelope view the per-column min/max
      // is small-sample noise: a filled envelope there reads as a fuzzy
      // block. DAW editors render this regime as a connected per-sample
      // curve instead, and it stays the readable rendering up to ~16
      // frames per column, past which the min/max envelope is again the
      // informative shape.
      const sampleCurve = sampleLevel && framesPerColumn <= 16;
      let level = s.peaks.levels[0];
      if (!sampleLevel) {
        for (const l of s.peaks.levels) {
          if (l.framesPerBucket <= framesPerColumn * 2) level = l;
        }
      }
      const fpb = level.framesPerBucket;
      const minMax = level.minMax;
      const rms = level.rms;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // device-pixel space for this pass
      const midDev = mid * dpr;
      const halfDev = half * dpr;

      if (sampleStems) {
        for (let xd = 0; xd < deviceWidth; xd += 1) {
          // Continuous tick -> sample conversion: floor(t0) would quantize each
          // column to a whole tick (500 frames at 120 BPM / 48 kHz), which at
          // sample-level zoom turns every column into a full-tick envelope.
          const t0 = this.xToTick(xd / dpr, scrollTick, pxPerTick);
          const t1 = this.xToTick((xd + 1) / dpr, scrollTick, pxPerTick);
          const f0 = Math.max(0, Math.min(s.source.length, tickToSampleExport(t0, timeBase)));
          const f1 = Math.max(f0, Math.min(s.source.length, tickToSampleExport(t1, timeBase)));
          // Outside the source: draw nothing (otherwise the 1px minimum-height
          // fill paints a fake zero line past the end of the audio).
          if (f1 <= 0 || f0 >= s.source.length) continue;
          // Sample-visible zoom: every sample is a stem from the zero line
          // (the classic DAW sample view). The RMS band is meaningless at
          // this level and stays hidden.
          const data = s.source.data[c];
          for (let f = f0; f < f1; f++) {
            const tickF = (f * timeBase.bpm * 4) / (timeBase.sampleRate * 5) - timeBase.shift;
            const xF = Math.round((tickF - scrollTick) * pxPerTick * dpr);
            if (xF < 0 || xF >= deviceWidth) continue;
            const v = data[f];
            const yV = midDev - (v / 32768) * halfDev;
            // Integer edges: fractional fills antialias a soft fringe.
            const yTop = Math.round(Math.min(midDev, yV));
            const yBot = Math.round(Math.max(midDev, yV));
            ctx.fillStyle = outerColor;
            ctx.fillRect(xF, yTop, 1, Math.max(1, yBot - yTop));
          }
        }
      } else if (sampleCurve) {
        // Connected-sample curve: one polyline through every visible
        // sample with per-sample vertices in integer device coordinates,
        // instead of per-column fills. Stems take over below 3 px of
        // sample spacing, the envelope above the curve cutoff; the x
        // mapping matches the stems exactly so the two regimes join
        // seamlessly at the boundary.
        const data = s.source.data[c];
        const xScale = ((timeBase.bpm * 4) / (timeBase.sampleRate * 5)) * pxPerTick * dpr;
        const xOff = (-timeBase.shift - scrollTick) * pxPerTick * dpr;
        const fStart = Math.max(0, Math.floor(fromFrame));
        const fEnd = Math.min(s.source.length, Math.ceil(toFrame));
        ctx.strokeStyle = outerColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let f = fStart; f < fEnd; f++) {
          const xF = Math.round(f * xScale + xOff);
          if (xF < 0 || xF >= deviceWidth) continue;
          const yV = Math.round(midDev - (data[f] / 32768) * halfDev);
          if (started) ctx.lineTo(xF, yV);
          else {
            ctx.moveTo(xF, yV);
            started = true;
          }
        }
        ctx.stroke();
      } else {
        for (let xd = 0; xd < deviceWidth; xd += 1) {
          // Continuous tick -> sample conversion: floor(t0) would quantize each
          // column to a whole tick (500 frames at 120 BPM / 48 kHz), which at
          // sample-level zoom turns every column into a full-tick envelope.
          const t0 = this.xToTick(xd / dpr, scrollTick, pxPerTick);
          const t1 = this.xToTick((xd + 1) / dpr, scrollTick, pxPerTick);
          const f0 = Math.max(0, Math.min(s.source.length, tickToSampleExport(t0, timeBase)));
          const f1 = Math.max(f0, Math.min(s.source.length, tickToSampleExport(t1, timeBase)));
          // Outside the source: draw nothing (otherwise the 1px minimum-height
          // fill paints a fake zero line past the end of the audio).
          if (f1 <= 0 || f0 >= s.source.length) continue;
          let min = 32767;
          let max = -32768;
          let sumSquares = 0;
          let buckets = 0;
          if (sampleLevel) {
            // Raw per-lane samples: sample-accurate at zooms finer than the
            // cache (min/max/RMS of this lane's own channel, not the mix).
            const data = s.source.data[c];
            for (let f = f0; f < f1; f++) {
              const v = data[f];
              if (v < min) min = v;
              if (v > max) max = v;
              sumSquares += v * v;
              buckets += 1;
            }
          } else {
            const b0 = Math.floor(f0 / fpb);
            const b1 = Math.floor(f1 / fpb);
            for (let b = b0; b <= Math.min(b1, level.buckets - 1); b++) {
              min = Math.min(min, minMax[b * 2]);
              max = Math.max(max, minMax[b * 2 + 1]);
              sumSquares += rms[b] * rms[b];
              buckets += 1;
            }
          }
          if (buckets === 0 || min > max) continue;
          // Integer edges on both layers: fractional fill heights antialias a
          // soft 1px fringe onto every column, which at mid zoom reads as
          // blur. Integer-coordinate painting is the classic DAW envelope
          // look for the same reason.
          const yTop = Math.round(midDev - (max / 32768) * halfDev);
          const yBot = Math.round(midDev - (min / 32768) * halfDev);
          ctx.fillStyle = outerColor;
          ctx.fillRect(xd, yTop, 1, Math.max(1, yBot - yTop));
          // RMS band, centered on the zero line, darker inside the envelope.
          // Hidden unless the RMS layer toggle is on; also hidden at
          // sample-detail zoom (stems and curve), where it carries no
          // information.
          if (s.rmsVisible) {
            const r = (Math.sqrt(sumSquares / buckets) / 32768) * halfDev;
            const rTop = Math.round(midDev - r);
            const rBot = Math.round(midDev + r);
            ctx.fillStyle = innerColor;
            ctx.fillRect(xd, rTop, 1, Math.max(1, rBot - rTop));
          }
        }
      }
      ctx.restore(); // back to the DPR transform for the CSS-px layers below

      // Band overlay: envelope polylines for low / mid / high, drawn in the
      // same lane (never a separate track). Marker/selection/playhead stay on
      // top because this block runs before those layers.
      if (bandsOn) {
        const analysis = s.bandAnalysis!;
        this.drawBandEnvelope(ctx, analysis.low.peaks[c], COLORS.bandLow, 1, [], width, mid, half, scrollTick, pxPerTick, timeBase, s.source.length, 1);
        this.drawBandEnvelope(ctx, analysis.mid.peaks[c], COLORS.bandMid, 1, [4, 2], width, mid, half, scrollTick, pxPerTick, timeBase, s.source.length, 1);
        this.drawBandEnvelope(ctx, analysis.high.peaks[c], COLORS.bandHigh, 1.25, [], width, mid, half, scrollTick, pxPerTick, timeBase, s.source.length, 1);
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
    const level0 = peaks.levels[0];
    const bb = level0.framesPerBucket;
    // Envelope value at a bucket index (clamped at both ends).
    const bucketValue = (bucket: number, upper: boolean): number => {
      const i = Math.max(0, Math.min(level0.buckets - 1, bucket));
      return upper ? level0.minMax[i * 2 + 1] : level0.minMax[i * 2];
    };
    for (const upper of [true, false]) {
      ctx.beginPath();
      let drawing = false;
      for (let x = 0; x <= width; x += step) {
        const t0 = this.xToTick(x, scrollTick, pxPerTick);
        const t1 = this.xToTick(x + step, scrollTick, pxPerTick);
        const f0 = tickToSampleExport(Math.floor(t0), timeBase);
        const f1 = tickToSampleExport(Math.max(Math.floor(t0) + 1, Math.ceil(t1)), timeBase);
        const covered = Math.max(1, f1 - f0);
        const fc = (f0 + f1) / 2;
        let value: number;
        let loud: boolean;
        if (covered <= bb) {
          // Column finer than the cache: linear interpolation between the
          // surrounding buckets smooths the envelope past the bucket
          // resolution (the filtered signal itself is not retained).
          const bf = fc / bb;
          const b = Math.floor(bf);
          const frac = bf - b;
          const v0 = bucketValue(b, upper);
          const v1 = bucketValue(b + 1, upper);
          value = v0 + (v1 - v0) * frac;
          loud = Math.max(Math.abs(v0), Math.abs(v1)) >= BAND_DRAW_MIN_ABS;
        } else {
          const range = peakRange(peaks, sourceLength, f0, Math.max(f0 + 1, f1));
          value = upper ? range.max : range.min;
          loud = Math.max(Math.abs(range.min), Math.abs(range.max)) >= BAND_DRAW_MIN_ABS;
        }
        if (!loud) {
          drawing = false;
          continue;
        }
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

    // Cursor: the editing position the arrow keys, Z, Enter and P operate on.
    // Drawn as a dashed amber line on the overlay so it never reads as the
    // solid white playhead; without it a cursor move changed nothing on screen.
    const cursorX = this.tickToX(s.cursorTick, scrollTick, pxPerTick);
    if (cursorX >= -2 && cursorX <= width + 2) {
      ctx.save();
      ctx.strokeStyle = COLORS.accent;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cursorX + 0.5, 0);
      ctx.lineTo(cursorX + 0.5, height);
      ctx.stroke();
      ctx.restore();
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

    // No-audio region beyond the song's end (same hatching as the waveform).
    const endTick = (s.source.length * timeBase.bpm * 4) / (timeBase.sampleRate * 5) - timeBase.shift;
    const endX = endTick * pxPerTickOverview;
    if (endX < width) {
      ctx.fillStyle = this.stripePattern(ctx);
      ctx.fillRect(Math.max(0, endX), 0, width - Math.max(0, endX), OVERVIEW_HEIGHT);
      ctx.strokeStyle = COLORS.danger;
      ctx.beginPath();
      ctx.moveTo(Math.floor(endX) + 0.5, 0);
      ctx.lineTo(Math.floor(endX) + 0.5, OVERVIEW_HEIGHT);
      ctx.stroke();
    }
  }

  /** Cached diagonal-hatch tile for the no-audio region. */
  private stripePattern(ctx: CanvasRenderingContext2D): CanvasPattern {
    if (!this.stripes) {
      const tile = document.createElement("canvas");
      tile.width = 12;
      tile.height = 12;
      const tileCtx = tile.getContext("2d");
      if (tileCtx) {
        tileCtx.fillStyle = COLORS.panel;
        tileCtx.fillRect(0, 0, 12, 12);
        tileCtx.strokeStyle = "#39414C";
        tileCtx.lineWidth = 3;
        tileCtx.beginPath();
        tileCtx.moveTo(-3, 15);
        tileCtx.lineTo(15, -3);
        tileCtx.moveTo(-9, 9);
        tileCtx.lineTo(9, -9);
        tileCtx.moveTo(3, 21);
        tileCtx.lineTo(21, 3);
        tileCtx.stroke();
        this.stripes = ctx.createPattern(tile, "repeat");
      }
    }
    return this.stripes as CanvasPattern;
  }

  private stripes: CanvasPattern | null = null;
}
