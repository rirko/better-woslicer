/**
 * Transport: whole-track playback, slice preview, playhead animation and cue
 * triggering. Audio is decoded to float once per load; preview renders through
 * the exact export DSP (core/renderSlice) so what you hear is what you get.
 */

import { markerTicks } from "../core/wos.js";
import { renderSlice } from "../core/slicer.js";
import { sliceIndexAtOrBefore } from "../core/markers.js";
import { tickToSampleExport, TimeBase } from "../core/timebase.js";
import { PLAYBACK_RATES, DEFAULT_PLAYBACK_RATE } from "../core/rate.js";
import { findCueCrossing } from "../core/cuecursor.js";
import { CueSynth } from "./cue.js";
import { Store } from "./store.js";

export class Transport {
  private ctx: AudioContext;
  private cue: CueSynth;
  private playBuffer: AudioBuffer | null = null;
  private playNode: AudioBufferSourceNode | null = null;
  /** Last slice-preview node (P / O); tracked so a retrigger restarts it. */
  private previewNode: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private rafId = 0;
  private lastCueIndex = -1;
  private lastCueTick = 0;

  constructor(private store: Store) {
    this.ctx = new AudioContext();
    this.cue = new CueSynth(this.ctx);
  }

  setCueVolume(v: number): void {
    this.cue.setVolume(v);
  }

  /** Shared AudioContext (tap calibration must use the same audio clock). */
  getAudioContext(): AudioContext {
    return this.ctx;
  }

  /** Rebuilds the playback AudioBuffer after (re)loading a source. */
  loadSource(floatData: Float32Array[], sampleRate: number): void {
    this.stop();
    const buffer = this.ctx.createBuffer(floatData.length, floatData[0].length, sampleRate);
    for (let c = 0; c < floatData.length; c++) {
      buffer.copyToChannel(floatData[c] as unknown as Float32Array<ArrayBuffer>, c);
    }
    this.playBuffer = buffer;
    this.store.update({ playheadSample: 0 });
  }

  private timeBase(): TimeBase {
    const s = this.store.state;
    return { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source!.sampleRate };
  }

  /** Inverse of the playhead conversion: samples -> ticks. */
  private sampleToTick(sample: number): number {
    const s = this.store.state;
    const base = this.timeBase();
    return (sample * 4 * base.bpm) / (base.sampleRate * 5) - base.shift;
  }

  isPlaying(): boolean {
    return this.store.state.playing;
  }

  play(): void {
    const s = this.store.state;
    if (!this.playBuffer || !s.source || s.playing) return;
    // Whole-track playback is exclusive with slice auditioning.
    this.stopPreview();
    void this.ctx.resume();
    const node = this.ctx.createBufferSource();
    node.buffer = this.playBuffer;
    // Monitor rate from the store: it survives pause/stop, so every new node
    // must pick it up (the rate is only applied to whole-track playback).
    node.playbackRate.value = s.playbackRate;
    node.connect(this.ctx.destination);
    const offsetSamples = s.playheadSample;
    const when = 0;
    node.start(when, offsetSamples / this.playBuffer.sampleRate);
    node.onended = () => {
      if (this.playNode === node) {
        this.stop();
      }
    };
    this.playNode = node;
    this.startedAt = this.ctx.currentTime;
    this.startOffset = offsetSamples;
    this.lastCueIndex = -1;
    this.lastCueTick = this.sampleToTick(offsetSamples);
    this.store.update({ playing: true });
    this.tick();
  }

  pause(): void {
    if (!this.store.state.playing) return;
    const pos = this.currentSample();
    this.stop();
    this.store.update({ playheadSample: pos });
  }

  togglePlayPause(): void {
    if (this.store.state.playing) this.pause();
    else this.play();
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.stopPreview();
    if (this.playNode) {
      const node = this.playNode;
      this.playNode = null;
      node.onended = null;
      try {
        node.stop();
      } catch {
        // already stopped
      }
      node.disconnect();
    }
    this.store.update({ playing: false });
  }

  /**
   * Silences an in-flight slice preview. Preview nodes are independent of the
   * whole-track node, so stop()/play() must release them explicitly; otherwise
   * a second P press starts a new node on top of the still-sounding one.
   */
  private stopPreview(): void {
    if (!this.previewNode) return;
    const node = this.previewNode;
    this.previewNode = null;
    node.onended = null;
    try {
      node.stop();
    } catch {
      // already stopped
    }
    node.disconnect();
  }

  seekSample(sample: number): void {
    const s = this.store.state;
    if (!s.source) return;
    const clamped = Math.max(0, Math.min(s.source.length, Math.floor(sample)));
    if (s.playing) {
      this.stop();
      this.store.update({ playheadSample: clamped });
      this.play();
    } else {
      this.store.update({ playheadSample: clamped });
    }
  }

  currentSample(): number {
    const s = this.store.state;
    if (!s.playing || !s.source) return s.playheadSample;
    // Rate-aware anchor: startOffset + (now - startedAt) * rate * sampleRate.
    // setRate() re-anchors both variables at every rate change, so this stays
    // continuous across switches and the playhead never jumps.
    const elapsed = (this.ctx.currentTime - this.startedAt) * s.playbackRate * s.source.sampleRate;
    return Math.min(s.source.length, this.startOffset + elapsed);
  }

  /**
   * Sets the monitor rate. While playing, the playhead anchor is recomputed
   * FIRST (startOffset = current sample, startedAt = now, both under the old
   * rate) and only then does the store rate change; the running node's
   * playbackRate is updated in place instead of restarting, so there is no
   * audio glitch and the displayed position does not jump.
   */
  setRate(rate: number): void {
    const s = this.store.state;
    const valid = PLAYBACK_RATES.includes(rate);
    const next = valid ? rate : DEFAULT_PLAYBACK_RATE;
    if (s.playing && s.source && next !== s.playbackRate) {
      this.startOffset = this.currentSample();
      this.startedAt = this.ctx.currentTime;
      if (this.playNode) this.playNode.playbackRate.value = next;
    }
    this.store.update({ playbackRate: next });
  }

  /** Preview: render the slice at/before the cursor with the export DSP. */
  previewSlice(previous = false): void {
    const s = this.store.state;
    const source = s.source;
    if (!source) return;
    const base = this.timeBase();
    // Cuts beyond the end of the audio are illegal and never preview.
    const ticks = markerTicks(s.doc.markers).filter(
      (t) => tickToSampleExport(t, base) <= source.length
    );
    if (!ticks.length) {
      this.store.setStatus("noMarkersToPreview");
      return;
    }
    let index = sliceIndexAtOrBefore(ticks, s.cursorTick);
    if (index < 0) index = 0;
    if (previous) index = Math.max(0, index - 1);
    const start = tickToSampleExport(ticks[index], base);
    const end =
      index + 1 < ticks.length ? tickToSampleExport(ticks[index + 1], base) : source.length;
    const rendered = renderSlice(
      { sampleRate: source.sampleRate, channels: source.channels, length: source.length, data: source.data },
      {
        start,
        end,
        fadeoutMs: s.doc.fadeoutMs,
        noisegateDb: s.noisegateEnabled ? s.doc.noisegateDb : 0,
      }
    );
    if (rendered.length === 0) {
      // A cut exactly at the end of the audio: a legal empty slice.
      this.store.setStatus("emptySlice");
      return;
    }
    this.playRendered(rendered.channelsData, rendered.sampleRate);
    this.store.setStatus("previewSlice", { slice: String(index).padStart(3, "0"), tick: ticks[index] });
  }

  /**
   * Plays an already-rendered slice (int16 channels). Deliberately does NOT
   * apply the monitor rate: slice preview (P / O) is auditioning the exported
   * result and stays at 1x, independent of the whole-track playback rate.
   */
  playRendered(channelsData: Int16Array[], sampleRate: number): void {
    // stop() releases the previous preview (and the whole-track node), so
    // pressing P again retriggers the slice instead of layering a second copy.
    this.stop();
    void this.ctx.resume();
    const buffer = this.ctx.createBuffer(channelsData.length, channelsData[0].length, sampleRate);
    for (let c = 0; c < channelsData.length; c++) {
      const ch = buffer.getChannelData(c);
      const src = channelsData[c];
      for (let i = 0; i < src.length; i++) ch[i] = src[i] / 32768;
    }
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.ctx.destination);
    node.onended = () => {
      if (this.previewNode === node) {
        this.previewNode = null;
        node.disconnect();
      }
    };
    this.previewNode = node;
    node.start();
  }

  /** Animation loop: playhead updates, follow-scroll and cue triggers. */
  private tick = (): void => {
    const s = this.store.state;
    if (!s.playing || !s.source) return;
    const sample = this.currentSample();
    const base = this.timeBase();
    const tickPos = this.sampleToTick(sample);

    // Cue trigger on upward marker crossings (pure logic, unit-tested). The
    // tick cursor advances even while cue is OFF so enabling it mid-play
    // cannot fire for markers the playhead already passed.
    const ticks = markerTicks(s.doc.markers);
    const idx = findCueCrossing(ticks, this.lastCueTick, tickPos, this.lastCueIndex);
    this.lastCueTick = tickPos;
    if (s.cueMode !== "off" && idx >= 0 && idx !== this.lastCueIndex) {
      this.lastCueIndex = idx;
      this.cue.trigger(s.cueMode);
    }

    const patch: { playheadSample: number; scrollTick?: number } = { playheadSample: sample };
    if (s.followPlayhead) {
      const wrap = document.getElementById("wave-wrap");
      const width = wrap ? wrap.clientWidth : 800;
      const viewLeft = s.scrollTick;
      const viewRight = viewLeft + width / s.pxPerTick;
      if (tickPos < viewLeft || tickPos > viewRight - width / s.pxPerTick * 0.05) {
        patch.scrollTick = Math.max(0, tickPos - (width / s.pxPerTick) * 0.1);
      }
    }
    this.store.update(patch);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
