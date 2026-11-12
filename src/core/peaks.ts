/**
 * Peak cache for waveform drawing.
 *
 * Building is O(n) once per loaded file; drawing never rescans the whole
 * file. Buckets are computed at the minimum zoom resolution and downsamples
 * hierarchically, so any pixels-per-frame zoom level can be served by
 * combining a small number of cached min/max pairs.
 *
 * Each bucket also carries an RMS value (root-mean-square over the bucket's
 * frames, across channels — the same cross-channel model as min/max). The
 * renderer draws the min/max envelope in a light tone and the RMS band in a
 * darker tone (the classic DAW two-tone style), so dense audio shows its
 * envelope shape instead of a solid block. Downsampled levels combine child
 * RMS values as sqrt(mean(rms²)) — the exact RMS of the covered frames.
 */

export interface PeakLevel {
  /** Frames per bucket at this level. */
  framesPerBucket: number;
  /** min/max pairs, interleaved: [min0, max0, min1, max1, ...]. */
  minMax: Float32Array;
  /** RMS per bucket (across channels), same bucket order as minMax. */
  rms: Float32Array;
  buckets: number;
}

export interface PeakCache {
  levels: PeakLevel[];
}

/** Builds a hierarchical peak cache for int16 channel data. */
export function buildPeakCache(channelsData: Int16Array[], baseBucket = 256): PeakCache {
  if (baseBucket < 1) throw new RangeError('baseBucket must be >= 1');
  const channels = channelsData.length;
  const length = channels === 0 ? 0 : channelsData[0].length;

  const buckets = Math.max(1, Math.ceil(length / baseBucket));
  const base = new Float32Array(buckets * 2);
  const baseRms = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    let min = 32767;
    let max = -32768;
    let sumSquares = 0;
    let count = 0;
    const startF = b * baseBucket;
    const endF = Math.min(length, startF + baseBucket);
    for (let f = startF; f < endF; f++) {
      for (let c = 0; c < channels; c++) {
        const v = channelsData[c][f];
        if (v < min) min = v;
        if (v > max) max = v;
        sumSquares += v * v;
        count += 1;
      }
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    base[b * 2] = min;
    base[b * 2 + 1] = max;
    baseRms[b] = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  }

  const levels: PeakLevel[] = [
    { framesPerBucket: baseBucket, minMax: base, rms: baseRms, buckets },
  ];
  // Hierarchical x4 summary levels keep even extreme zoom-outs cheap.
  while (levels[levels.length - 1].buckets > 1) {
    const prev = levels[levels.length - 1];
    const count = Math.ceil(prev.buckets / 4);
    const next = new Float32Array(count * 2);
    const nextRms = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let min = 32767;
      let max = -32768;
      let sumSquares = 0;
      let members = 0;
      for (let j = i * 4; j < Math.min(prev.buckets, (i + 1) * 4); j++) {
        min = Math.min(min, prev.minMax[j * 2]);
        max = Math.max(max, prev.minMax[j * 2 + 1]);
        sumSquares += prev.rms[j] * prev.rms[j];
        members += 1;
      }
      if (min > max) {
        min = 0;
        max = 0;
      }
      next[i * 2] = min;
      next[i * 2 + 1] = max;
      // Equal-width child buckets: the RMS of the union is the quadratic
      // mean of the child RMS values.
      nextRms[i] = members > 0 ? Math.sqrt(sumSquares / members) : 0;
    }
    levels.push({
      framesPerBucket: prev.framesPerBucket * 4,
      minMax: next,
      rms: nextRms,
      buckets: count,
    });
  }
  return { levels };
}

export interface MinMaxRms {
  min: number;
  max: number;
  rms: number;
}

/**
 * Min/max/RMS over [startFrame, endFrame) using the cache. Never scans raw
 * samples; cost is proportional to the number of covered base buckets. The
 * RMS of unequal-width bucket groups is the quadratic mean weighted by
 * bucket width (the last group may be partial).
 */
export function peakRange(
  cache: PeakCache,
  length: number,
  startFrame: number,
  endFrame: number,
): MinMaxRms {
  const clampedStart = Math.max(0, Math.min(length, Math.floor(startFrame)));
  const clampedEnd = Math.max(clampedStart, Math.min(length, Math.ceil(endFrame)));
  if (clampedEnd === clampedStart) return { min: 0, max: 0, rms: 0 };

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
  let sumSquares = 0;
  let frames = 0;
  const firstBucket = Math.floor(clampedStart / level.framesPerBucket);
  const lastBucket = Math.ceil(clampedEnd / level.framesPerBucket);
  for (let b = firstBucket; b < Math.min(lastBucket, level.buckets); b++) {
    min = Math.min(min, level.minMax[b * 2]);
    max = Math.max(max, level.minMax[b * 2 + 1]);
    sumSquares += level.rms[b] * level.rms[b];
    frames += 1;
  }
  if (min > max) return { min: 0, max: 0, rms: 0 };
  return { min, max, rms: frames > 0 ? Math.sqrt(sumSquares / frames) : 0 };
}
