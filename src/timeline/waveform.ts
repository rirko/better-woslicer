import { peakRange, type PeakCache } from '../core/peaks';
import { BAND_DRAW_MIN_ABS } from '../core/bands';
import type { TimeBase } from '../core/timebase';

export interface WaveViewport {
  width: number;
  dpr: number;
  scrollTick: number;
  pxPerTick: number;
  timeBase: TimeBase;
}
export function sampleToTick(sample: number, base: TimeBase): number {
  return (sample * base.bpm * 4) / (base.sampleRate * 5) - base.shift;
}
/** Continuous conversion is essential when one viewport spans less than a tick. */
export function tickToFrame(tick: number, base: TimeBase): number {
  return ((tick + base.shift) * base.sampleRate * 5) / (base.bpm * 4);
}
export function waveformRegime(
  framesPerDevicePixel: number,
  dpr: number,
  baseBucket: number,
): 'stems' | 'curve' | 'raw' | 'peaks' {
  if (framesPerDevicePixel >= baseBucket) return 'peaks';
  if (framesPerDevicePixel * dpr <= 1 / 3) return 'stems';
  return framesPerDevicePixel <= 16 ? 'curve' : 'raw';
}

/** Device-pixel min/max + RMS, or source-sample curves/stems at detail zoom. */
export function drawWaveLane(
  context: CanvasRenderingContext2D,
  view: WaveViewport,
  data: Int16Array,
  peaks: PeakCache,
  mid: number,
  half: number,
  colors: { outer: string; rms: string },
  rmsVisible: boolean,
): void {
  const base = peaks.levels[0];
  if (!base || data.length === 0 || view.width <= 0) return;
  const deviceWidth = Math.max(1, Math.floor(view.width * view.dpr));
  const framesPerColumn =
    (view.timeBase.sampleRate * 5) / (view.timeBase.bpm * 4 * view.pxPerTick * view.dpr);
  const regime = waveformRegime(framesPerColumn, view.dpr, base.framesPerBucket);
  let level = base;
  for (const candidate of peaks.levels)
    if (candidate.framesPerBucket <= framesPerColumn * 2) level = candidate;
  const startFrame = tickToFrame(view.scrollTick, view.timeBase);
  const frameX = (frame: number) =>
    (sampleToTick(frame, view.timeBase) - view.scrollTick) * view.pxPerTick * view.dpr;
  const middle = mid * view.dpr,
    amplitude = half * view.dpr;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = colors.outer;
  context.strokeStyle = colors.outer;
  context.lineWidth = 1;
  if (regime === 'stems' || regime === 'curve') {
    const from = Math.max(0, Math.floor(startFrame));
    const to = Math.min(data.length, Math.ceil(startFrame + deviceWidth * framesPerColumn) + 1);
    context.beginPath();
    for (let frame = from; frame < to; frame++) {
      const value = data[frame] ?? 0;
      const x = Math.round(frameX(frame));
      const y = Math.round(middle - (value / 32768) * amplitude);
      if (regime === 'stems') {
        if (x >= 0 && x < deviceWidth)
          context.fillRect(
            x,
            Math.min(Math.round(middle), y),
            1,
            Math.max(1, Math.abs(Math.round(middle) - y)),
          );
      } else if (frame === from) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    if (regime === 'curve') context.stroke();
  } else {
    for (let x = 0; x < deviceWidth; x++) {
      const from = Math.max(0, Math.floor(startFrame + x * framesPerColumn));
      const to = Math.min(data.length, Math.ceil(startFrame + (x + 1) * framesPerColumn));
      if (from >= data.length || to <= from) continue;
      let min = 32767,
        max = -32768,
        squares = 0,
        count = 0;
      if (regime === 'raw') {
        for (let frame = from; frame < to; frame++) {
          const value = data[frame] ?? 0;
          min = Math.min(min, value);
          max = Math.max(max, value);
          squares += value * value;
          count++;
        }
      } else {
        const firstBucket = Math.floor(from / level.framesPerBucket);
        const lastBucket = Math.min(level.buckets, Math.ceil(to / level.framesPerBucket));
        for (let bucket = firstBucket; bucket < lastBucket; bucket++) {
          min = Math.min(min, level.minMax[bucket * 2] ?? 0);
          max = Math.max(max, level.minMax[bucket * 2 + 1] ?? 0);
          const rms = level.rms[bucket] ?? 0;
          squares += rms * rms;
          count++;
        }
      }
      if (!count) continue;
      const top = Math.round(middle - (max / 32768) * amplitude);
      const bottom = Math.round(middle - (min / 32768) * amplitude);
      context.fillStyle = colors.outer;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
      if (rmsVisible) {
        const radius = (Math.sqrt(squares / count) / 32768) * amplitude;
        const top = Math.round(middle - radius),
          bottom = Math.round(middle + radius);
        context.fillStyle = colors.rms;
        context.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    }
  }
  context.restore();
}

/** Interpolated band envelopes with silence gaps; cache values stay source-time. */
export function drawBandEnvelope(
  context: CanvasRenderingContext2D,
  view: WaveViewport,
  peaks: PeakCache,
  length: number,
  mid: number,
  half: number,
  color: string,
  dash: number[],
  lineWidth: number,
): void {
  const base = peaks.levels[0];
  if (!base) return;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.setLineDash(dash);
  for (const upper of [true, false]) {
    context.beginPath();
    let drawing = false;
    for (let x = 0; x <= view.width; x++) {
      const first = tickToFrame(view.scrollTick + x / view.pxPerTick, view.timeBase);
      const last = tickToFrame(view.scrollTick + (x + 1) / view.pxPerTick, view.timeBase);
      if (last <= 0 || first >= length) {
        drawing = false;
        continue;
      }
      let value: number, loud: boolean;
      if (last - first <= base.framesPerBucket) {
        const center = (first + last) / (2 * base.framesPerBucket);
        const bucket = Math.floor(center),
          fraction = center - bucket;
        const valueAt = (index: number) =>
          base.minMax[Math.max(0, Math.min(base.buckets - 1, index)) * 2 + (upper ? 1 : 0)] ?? 0;
        const a = valueAt(bucket),
          b = valueAt(bucket + 1);
        value = a + (b - a) * fraction;
        loud = Math.max(Math.abs(a), Math.abs(b)) >= BAND_DRAW_MIN_ABS;
      } else {
        const range = peakRange(peaks, length, first, last);
        value = upper ? range.max : range.min;
        loud = Math.max(Math.abs(range.min), Math.abs(range.max)) >= BAND_DRAW_MIN_ABS;
      }
      if (!loud) {
        drawing = false;
        continue;
      }
      const y = mid - (value / 32768) * half;
      if (drawing) context.lineTo(x, y);
      else {
        context.moveTo(x, y);
        drawing = true;
      }
    }
    context.stroke();
  }
  context.setLineDash([]);
}
