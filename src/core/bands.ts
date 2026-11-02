/**
 * Three-band split for the overlay display and band detection.
 *
 * Crossover points are fixed at 250 Hz / 4 kHz (DEEPSEEK frozen spec):
 *   low  = lowpass 250 Hz
 *   mid  = highpass 250 Hz -> lowpass 4 kHz
 *   high = highpass 4 kHz
 * Each channel is filtered independently; the filters are RBJ biquads
 * (Butterworth Q), so the whole module is deterministic and unit-testable.
 */

import { buildPeakCache, PeakCache } from "./peaks.js";

export type BandName = "low" | "mid" | "high";

export const BAND_CROSSOVERS = { lowMid: 250, midHigh: 4000 } as const;
export const BAND_NAMES: readonly BandName[] = ["low", "mid", "high"] as const;

/** -60 dBFS gate for drawing (int16 scale). */
export const BAND_DRAW_MIN_ABS = Math.round(32768 * Math.pow(10, -60 / 20));

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const Q_BUTTERWORTH = Math.SQRT1_2;

export function lowpassCoeffs(sampleRate: number, cutoff: number, q = Q_BUTTERWORTH): Biquad {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function highpassCoeffs(sampleRate: number, cutoff: number, q = Q_BUTTERWORTH): Biquad {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Direct form II transposed; returns a new array (input untouched). */
export function applyBiquad(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    out[i] = y;
  }
  return out;
}

/** Splits one channel (normalized float samples) into the requested band. */
export function filterBand(samples: Float32Array, sampleRate: number, band: BandName): Float32Array {
  switch (band) {
    case "low":
      return applyBiquad(samples, lowpassCoeffs(sampleRate, BAND_CROSSOVERS.lowMid));
    case "high":
      return applyBiquad(samples, highpassCoeffs(sampleRate, BAND_CROSSOVERS.midHigh));
    case "mid": {
      const hp = applyBiquad(samples, highpassCoeffs(sampleRate, BAND_CROSSOVERS.lowMid));
      return applyBiquad(hp, lowpassCoeffs(sampleRate, BAND_CROSSOVERS.midHigh));
    }
  }
}

/** RMS per hop window (linear, 0..1). Last partial hop is included. */
export function rmsEnvelope(samples: Float32Array, hopSamples: number): Float32Array {
  if (hopSamples < 1) throw new RangeError("hopSamples must be >= 1");
  const frames = Math.ceil(samples.length / hopSamples);
  const out = new Float32Array(Math.max(1, frames));
  for (let f = 0; f < out.length; f++) {
    const start = f * hopSamples;
    const end = Math.min(samples.length, start + hopSamples);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    out[f] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  return out;
}

export interface BandSignal {
  /** Per-channel peak caches built from the filtered signal. */
  peaks: PeakCache[];
  /** Per-channel RMS envelope (hop = analysis.hopSamples). */
  rms: Float32Array[];
}

export interface BandAnalysis {
  sampleRate: number;
  hopSamples: number;
  low: BandSignal;
  mid: BandSignal;
  high: BandSignal;
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round(samples[i] * 32768);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

/**
 * Filters every band/channel once and keeps only the derived data (peak cache
 * + RMS envelope). The filtered Float32 buffers are transient, so memory stays
 * proportional to the source rather than to bands x channels x length.
 */
export function analyzeBands(channels: Int16Array[], sampleRate: number, hopMs = 10): BandAnalysis {
  const hopSamples = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const build = (band: BandName): BandSignal => {
    const peaks: PeakCache[] = [];
    const rms: Float32Array[] = [];
    for (const channel of channels) {
      const floats = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) floats[i] = channel[i] / 32768;
      const filtered = filterBand(floats, sampleRate, band);
      peaks.push(buildPeakCache([toInt16(filtered)]));
      rms.push(rmsEnvelope(filtered, hopSamples));
    }
    return { peaks, rms };
  };
  return { sampleRate, hopSamples, low: build("low"), mid: build("mid"), high: build("high") };
}
