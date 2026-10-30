/**
 * Cue sounds — synthesized with Web Audio (no samples, nothing written into
 * exports). Available: cowbell, triangle, metronome; plus "off".
 */

import { CueMode } from "./store.js";

export class CueSynth {
  private master: GainNode | null = null;

  constructor(private ctx: AudioContext) {
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    gain.connect(ctx.destination);
    this.master = gain;
  }

  setVolume(volume: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, volume));
  }

  /** Fires a cue hit. Safe to call frequently; each hit builds tiny nodes. */
  trigger(mode: CueMode): void {
    if (mode === "off") return;
    const now = this.ctx.currentTime;
    switch (mode) {
      case "metronome":
        this.metronome(now);
        break;
      case "cowbell":
        this.cowbell(now);
        break;
      case "triangle":
        this.triangle(now);
        break;
    }
  }

  /** Classic 808-style cowbell: two detuned squares through a bandpass. */
  private cowbell(t: number): void {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.9, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2640;
    bp.Q.value = 1.2;
    for (const f of [560, 845]) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = f;
      osc.connect(bp);
      osc.start(t);
      osc.stop(t + 0.26);
    }
    bp.connect(out);
    out.connect(this.master as GainNode);
  }

  /** Triangle instrument: bright high ping with a long shimmer. */
  private triangle(t: number): void {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.7, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    for (const [f, g] of [
      [2637, 1],
      [3951, 0.4],
      [5274, 0.2],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g1 = ctx.createGain();
      g1.gain.value = g;
      osc.connect(g1);
      g1.connect(out);
      osc.start(t);
      osc.stop(t + 0.95);
    }
    out.connect(this.master as GainNode);
  }

  /** Metronome: short sine blip plus a noise tick. */
  private metronome(t: number): void {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.9, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1568;
    osc.connect(out);
    osc.start(t);
    osc.stop(t + 0.07);

    const noiseLen = Math.floor(ctx.sampleRate * 0.01);
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    src.connect(ng);
    ng.connect(out);
    src.start(t);

    out.connect(this.master as GainNode);
  }
}
