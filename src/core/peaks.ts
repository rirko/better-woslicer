/**
 * Peak cache for waveform drawing.
 *
 * Building is O(n) once per loaded file; drawing never rescans the whole
 * file. Buckets are computed at the minimum zoom resolution and downsamples
 * hierarchically, so any pixels-per-frame zoom level can be served by
 * combining a small number of cached min/max pairs.
 */

export interface PeakLevel {
  /** Frames per bucket at this level. */
  framesPerBucket: number;
  /** min/max pairs, interleaved: [min0, max0, min1, max1, ...]. */
  minMax: Float32Array;
  buckets: number;
}

export interface PeakCache {
  levels: PeakLevel[];
}

/** Builds a hierarchical peak cache for int16 channel data. */
export function buildPeakCache(channelsData: Int16Array[], baseBucket = 256): PeakCache {
  if (baseBucket < 1) throw new RangeError("baseBucket must be >= 1");
  const channels = channelsData.length;
  const length = channels === 0 ? 0 : channelsData[0].length;

  const buckets = Math.max(1, Math.ceil(length / baseBucket));
  const base = new Float32Array(buckets * 2);
  for (let b = 0; b < buckets; b++) {
    let min = 32767;
    let max = -32768;
    const startF = b * baseBucket;
    const endF = Math.min(length, startF + baseBucket);
    for (let f = startF; f < endF; f++) {
      for (let c = 0; c < channels; c++) {
        const v = channelsData[c][f];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    base[b * 2] = min;
    base[b * 2 + 1] = max;
  }

  const levels: PeakLevel[] = [{ framesPerBucket: baseBucket, minMax: base, buckets }];
  // Hierarchical x4 summary levels keep even extreme zoom-outs cheap.
  while (levels[levels.length - 1].buckets > 1) {
    const prev = levels[levels.length - 1];
    const count = Math.ceil(prev.buckets / 4);
    const next = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      let min = 32767;
      let max = -32768;
      for (let j = i * 4; j < Math.min(prev.buckets, (i + 1) * 4); j++) {
        min = Math.min(min, prev.minMax[j * 2]);
        max = Math.max(max, prev.minMax[j * 2 + 1]);
      }
      if (min > max) {
        min = 0;
        max = 0;
      }
      next[i * 2] = min;
      next[i * 2 + 1] = max;
    }
    levels.push({ framesPerBucket: prev.framesPerBucket * 4, minMax: next, buckets: count });
  }
  return { levels };
}

export interface MinMax {
  min: number;
  max: number;
}

/**
 * Min/max over [startFrame, endFrame) using the cache. Never scans raw
 * samples; cost is proportional to the number of covered base buckets.
 */
export function peakRange(cache: PeakCache, length: number, startFrame: number, endFrame: number): MinMax {
  const clampedStart = Math.max(0, Math.min(length, Math.floor(startFrame)));
  const clampedEnd = Math.max(clampedStart, Math.min(length, Math.ceil(endFrame)));
  if (clampedEnd === clampedStart) return { min: 0, max: 0 };

  // Pick the finest cached level with at most ~4096 buckets in range.
  let level = cache.levels[0];
  for (const l of cache.levels) {
    const covered = (clampedEnd - clampedStart) / l.framesPerBucket;
    if (covered <= 4096) {
      level = l;
      break;
    }
  }

  let min = 32767;
  let max = -32768;
  const firstBucket = Math.floor(clampedStart / level.framesPerBucket);
  const lastBucket = Math.ceil(clampedEnd / level.framesPerBucket);
  for (let b = firstBucket; b < Math.min(lastBucket, level.buckets); b++) {
    min = Math.min(min, level.minMax[b * 2]);
    max = Math.max(max, level.minMax[b * 2 + 1]);
  }
  if (min > max) return { min: 0, max: 0 };
  return { min, max };
}
