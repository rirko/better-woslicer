/**
 * Continuous tap-calibration session on the shared AudioContext.
 *
 * Clicks are scheduled on the audio clock in a rolling window (2 s ahead), so
 * the metronome can run indefinitely — there is no 16-beat limit. Every Enter
 * / ',' / '.' tap is recorded on the same clock, and the statistics can be
 * queried at any moment (the modal shows a live median while the clicks keep
 * playing). Finish simply stops the clicks and freezes the current result.
 */

import { analyzeTaps, beatIntervalMs, CalibrationResult } from '../core/calibration.js';

export class TapCalibrator {
  private active = false;
  /** Audio-clock times of the scheduled clicks (grows while running). */
  private beats: number[] = [];
  private taps: number[] = [];
  private startTime = 0;
  private intervalSec = 0;
  private nextBeat = 0;
  private nodes: { node: AudioScheduledSourceNode; gain: GainNode; stopAt: number }[] = [];

  constructor(private ctx: AudioContext) {}

  isActive(): boolean {
    return this.active;
  }

  tapCount(): number {
    return this.taps.length;
  }

  /** 1-based index of the beat currently sounding (or about to). */
  elapsedBeats(): number {
    if (!this.active || this.intervalSec <= 0) return 0;
    return Math.max(0, Math.floor((this.ctx.currentTime - this.startTime) / this.intervalSec) + 1);
  }

  /** Starts the click train; scheduling continues in ensureScheduled(). */
  start(bpm: number): void {
    this.cancel();
    this.intervalSec = beatIntervalMs(bpm) / 1000;
    this.active = true;
    this.taps = [];
    this.beats = [];
    this.nextBeat = 0;
    this.startTime = this.ctx.currentTime + 0.2;
    this.ensureScheduled();
  }

  /** Keeps ~2 s of clicks scheduled ahead; call from the UI timer. */
  ensureScheduled(): void {
    if (!this.active) return;
    const horizon = this.ctx.currentTime + 2;
    while (this.startTime + this.nextBeat * this.intervalSec < horizon) {
      const when = this.startTime + this.nextBeat * this.intervalSec;
      this.beats.push(when);
      this.click(when, this.nextBeat % 4 === 0);
      this.nextBeat++;
    }
    const now = this.ctx.currentTime;
    this.nodes = this.nodes.filter((entry) => entry.stopAt >= now - 1);
    // Keep the reference list bounded for very long sessions; taps older than
    // the retained window are simply no longer matched.
    if (this.beats.length > 8192) this.beats = this.beats.slice(-4096);
  }

  /** Records one tap on the audio clock. */
  tap(): void {
    if (this.active) this.taps.push(this.ctx.currentTime);
  }

  /** Live statistics without stopping the click train. */
  currentResult(): CalibrationResult {
    const beatMs = this.beats.map((t) => (t - this.startTime) * 1000);
    const tapMs = this.taps.map((t) => (t - this.startTime) * 1000);
    return analyzeTaps(tapMs, beatMs);
  }

  /** Stops the clicks and returns the final statistics. */
  finish(): CalibrationResult {
    const result = this.currentResult();
    this.cancel();
    return result;
  }

  /** Stops all scheduled clicks (cancel / close / restart). */
  cancel(): void {
    this.active = false;
    for (const entry of this.nodes) {
      try {
        entry.node.stop();
      } catch {
        // already stopped
      }
      entry.node.onended = null;
      entry.node.disconnect();
      entry.gain.disconnect();
    }
    this.nodes = [];
  }

  private click(when: number, accent: boolean): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.45, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      osc.onended = null;
    };
    osc.start(when);
    osc.stop(when + 0.06);
    this.nodes.push({ node: osc, gain, stopAt: when + 0.06 });
  }
}
