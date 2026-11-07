/**
 * Minimal piano-roll canvas renderer for BMHelper sequences (a port of the
 * original MidiView's essentials): dark background, measure/beat/sub grid
 * lines, green velocity-shaded note bars, horizontal wheel scroll and
 * Ctrl+wheel zoom on the time axis. Pitch range fits the drawn notes.
 */

import type { MidiNoteEvent } from "../core/smf.js";
import { palette } from "./theme.js";

export interface PianoRollView {
  /** Redraws with the current scroll/zoom state. */
  draw(): void;
  /** Attaches wheel handlers (call once). Returns the detach function. */
  attach(element: HTMLElement): () => void;
}

const SUB_DIVISIONS = 4; // grid lines per beat

export function createPianoRoll(
  canvas: HTMLCanvasElement,
  getSequence: () => { quantize: number; notes: MidiNoteEvent[] } | null
): PianoRollView {
  let pxPerBeat = 24;
  let firstBeat = 0;

  function draw(): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * (window.devicePixelRatio || 1)) {
      canvas.width = Math.max(1, width * (window.devicePixelRatio || 1));
    }
    canvas.height = Math.max(1, height * (window.devicePixelRatio || 1));
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    context.fillStyle = palette().app;
    context.fillRect(0, 0, width, height);

    const sequence = getSequence();
    if (!sequence || sequence.notes.length === 0) return;

    const beat = sequence.quantize;
    const pxPerTick = pxPerBeat / beat;
    const xOf = (tick: number) => (tick / beat - firstBeat) * pxPerBeat;

    // Grid: measures (4/4), beats, sub-beats.
    const lastBeat = firstBeat + width / pxPerBeat;
    for (let b = Math.floor(firstBeat * SUB_DIVISIONS); b <= Math.ceil(lastBeat * SUB_DIVISIONS); b++) {
      const x = b * (pxPerBeat / SUB_DIVISIONS);
      context.fillStyle = b % (4 * SUB_DIVISIONS) === 0 ? palette().surface3 : b % SUB_DIVISIONS === 0 ? palette().surface2 : palette().surface1;
      context.fillRect(x, 0, 1, height);
    }

    // Vertical fit: the drawn notes' pitch range with padding.
    const nnMin = Math.min(...sequence.notes.map((n) => n.nn)) - 2;
    const nnMax = Math.max(...sequence.notes.map((n) => n.nn)) + 2;
    const span = Math.max(12, nnMax - nnMin);
    const yOf = (nn: number) => height - ((nn - nnMin + 1) / span) * height;
    const barHeight = Math.max(2, height / span - 1);

    for (const note of sequence.notes) {
      const x = xOf(note.position);
      const w = Math.max(2, note.gate * pxPerTick);
      if (x + w < 0 || x > width) continue;
      // Brightness keyed to velocity, like the original's green gradient.
      const level = 40 + Math.round((note.vel / 127) * 120);
      context.fillStyle = `rgb(${level - 20}, ${level + 60}, ${level - 10})`;
      context.fillRect(x, yOf(note.nn) - barHeight, w, barHeight);
    }
  }

  function attach(element: HTMLElement): () => void {
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey) {
        const factor = e.deltaY < 0 ? 1.25 : 0.8;
        pxPerBeat = Math.max(4, Math.min(256, pxPerBeat * factor));
      } else {
        firstBeat = Math.max(0, firstBeat + (e.deltaY + e.deltaX) / pxPerBeat);
      }
      draw();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }

  return { draw, attach };
}
