import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBands, filterBand, rmsEnvelope, BAND_CROSSOVERS } from '../src/core/bands.js';

const SR = 48000;

function sine(freq: number, seconds: number, amp = 0.5): Int16Array {
  const n = Math.round(seconds * SR);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * amp * 32768);
  return out;
}

function toFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
  return out;
}

function rms(values: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
  return Math.sqrt(sum / Math.max(1, values.length));
}

test('band split routes 100 Hz to Low, 1 kHz to Mid and 8 kHz to High', () => {
  for (const [freq, expected] of [
    [100, 'low'],
    [1000, 'mid'],
    [8000, 'high'],
  ] as const) {
    const floats = toFloat(sine(freq, 0.5));
    const energies = {
      low: rms(filterBand(floats, SR, 'low')),
      mid: rms(filterBand(floats, SR, 'mid')),
      high: rms(filterBand(floats, SR, 'high')),
    };
    const best = Object.entries<number>(energies).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(best, expected, `${freq} Hz energies=${JSON.stringify(energies)}`);
  }
});

test('crossover constants stay at the frozen 250 Hz / 4 kHz', () => {
  assert.equal(BAND_CROSSOVERS.lowMid, 250);
  assert.equal(BAND_CROSSOVERS.midHigh, 4000);
});

test('rmsEnvelope includes the trailing partial hop', () => {
  const env = rmsEnvelope(new Float32Array(1000), 480);
  assert.equal(env.length, 3); // 480 + 480 + 40
  assert.ok(env.every((v) => v === 0));
});

test('analyzeBands keeps per-channel peaks and RMS envelopes', () => {
  const analysis = analyzeBands([sine(1000, 0.2), sine(1000, 0.2)], SR);
  assert.equal(analysis.hopSamples, 480);
  assert.equal(analysis.low.peaks.length, 2);
  assert.equal(analysis.mid.rms.length, 2);
  assert.equal(analysis.high.peaks.length, 2);
  // 1 kHz tone: Mid must dominate Low and High by a wide margin.
  const mid = rms(analysis.mid.rms[0]);
  const low = rms(analysis.low.rms[0]);
  const high = rms(analysis.high.rms[0]);
  assert.ok(mid > low * 4, `mid=${mid} low=${low}`);
  assert.ok(mid > high * 4, `mid=${mid} high=${high}`);
});
