/**
 * Mouse interactions on the timeline:
 *  - click: move cursor (snap-aware)
 *  - drag on empty area: box selection; hold Shift to ADD to the existing
 *    selection, hold Ctrl to TOGGLE the markers inside the box
 *  - drag on a selected marker / inside selection: move the whole selection
 *    with a group clamp (relative spacing can never break)
 *  - middle button: pan
 *  - wheel: horizontal scroll; Ctrl+wheel: zoom anchored at the mouse tick
 *  - ruler: click = seek cursor; wheel = zoom anchored
 *  - overview: click/drag = center viewport; scrollbar thumb drag
 */

import { MAX_TICKS, tickToSampleExport } from "../core/timebase.js";
import { markerTicks } from "../core/wos.js";
import { clampGroupDelta, normalizeSelection } from "../core/markers.js";
import { Store } from "./store.js";
import { TimelineView } from "./waveform.js";

type DragMode =
  | { kind: "none" }
  | { kind: "box"; anchorTick: number; previousSelection: number[] }
  | { kind: "move"; anchorTick: number; originalTicks: number[] }
  | { kind: "pan"; anchorX: number; anchorScroll: number }
  | { kind: "thumb"; anchorX: number; anchorScroll: number; width: number };

export class Interactions {
  private drag: DragMode = { kind: "none" };
  private ghostDelta = 0;

  constructor(
    private store: Store,
    private view: TimelineView,
    private waveWrap: HTMLElement,
    private ruler: HTMLCanvasElement,
    private overview: HTMLCanvasElement,
    private scrollbar: HTMLElement,
    private scrollbarThumb: HTMLElement,
    private onDirty: () => void,
    private onSeek: (sample: number) => void
  ) {}

  attach(): void {
    (window as unknown as { __attachRan: boolean }).__attachRan = true;
    this.waveWrap.addEventListener("mousedown", this.onWaveMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    this.waveWrap.addEventListener("wheel", this.onWaveWheel, { passive: false });
    this.waveWrap.addEventListener("contextmenu", (e) => e.preventDefault());
    this.ruler.addEventListener("mousedown", this.onRulerMouseDown);
    this.ruler.addEventListener("wheel", this.onRulerWheel, { passive: false });
    this.overview.addEventListener("mousedown", this.onOverviewMouseDown);
    this.scrollbarThumb.addEventListener("mousedown", this.onThumbMouseDown);
    this.scrollbar.addEventListener("mousedown", this.onScrollbarMouseDown);
  }

  private viewMetrics(): { width: number; scrollTick: number; pxPerTick: number } {
    const width = this.waveWrap.clientWidth;
    const { scrollTick, pxPerTick } = this.store.state;
    return { width, scrollTick, pxPerTick };
  }

  private eventTick(e: MouseEvent): number {
    const rect = this.waveWrap.getBoundingClientRect();
    const { scrollTick, pxPerTick } = this.viewMetrics();
    return this.view.xToTick(e.clientX - rect.left, scrollTick, pxPerTick);
  }

  private clampedTick(tick: number): number {
    return Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick)));
  }

  private onWaveMouseDown = (e: MouseEvent): void => {
    const w = window as unknown as { __mousedownCount?: number; __lastMouseDownBranch?: string };
    w.__mousedownCount = (w.__mousedownCount ?? 0) + 1;
    this.waveWrap.focus();
    const tick = this.eventTick(e);
    if (e.button === 1) {
      this.drag = { kind: "pan", anchorX: e.clientX, anchorScroll: this.store.state.scrollTick };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const s = this.store.state;
    const { scrollTick, pxPerTick } = this.viewMetrics();
    const x = (tick - scrollTick) * pxPerTick;
    const ticks = markerTicks(s.doc.markers);
    const nearMarker = ticks.find((t) => Math.abs((t - scrollTick) * pxPerTick - x) <= 4);

    w.__lastMouseDownBranch = "probe";
    if (nearMarker !== undefined && (s.selectedTicks.includes(nearMarker) || s.selectedTicks.length === 0)) {
      w.__lastMouseDownBranch = "move:" + nearMarker;
      // Start moving the selection (or the single marker under the mouse).
      const original = s.selectedTicks.includes(nearMarker)
        ? [...s.selectedTicks]
        : [nearMarker];
      this.drag = { kind: "move", anchorTick: tick, originalTicks: original };
      if (!s.selectedTicks.includes(nearMarker)) {
        this.store.update({ selectedTicks: original, selectionStartTick: null, selectionEndTick: null });
      }
      this.store.setStatus(`Dragging ${original.length} marker(s)`);
      this.onDirty();
      return;
    }

    w.__lastMouseDownBranch = "box:" + this.clampedTick(tick);
    this.drag = {
      kind: "box",
      anchorTick: this.clampedTick(tick),
      // Shift/Ctrl merge against the selection as it was when the drag began.
      previousSelection: [...s.selectedTicks],
    };
    this.store.update({ selectionStartTick: this.clampedTick(tick), selectionEndTick: this.clampedTick(tick), selectedTicks: [] });
    this.store.setStatus("Box select (Shift = add, Ctrl = toggle)");
    this.onDirty();
  };

  private onMouseMove = (e: MouseEvent): void => {
    switch (this.drag.kind) {
      case "pan": {
        const dx = e.clientX - this.drag.anchorX;
        const scrollTick = Math.max(0, this.drag.anchorScroll - dx / this.store.state.pxPerTick);
        this.store.update({ scrollTick });
        this.onDirty();
        break;
      }
      case "box": {
        const tick = this.clampedTick(this.eventTick(e));
        this.store.update({ selectionEndTick: tick });
        this.onDirty();
        break;
      }
      case "move": {
        const rawDelta = this.eventTick(e) - this.drag.anchorTick;
        const requested = this.store.state.snap
          ? Math.round(rawDelta / this.store.state.grid) * this.store.state.grid
          : Math.round(rawDelta);
        // Group clamp: one shared delta keeps relative spacing intact.
        const delta = clampGroupDelta(this.drag.originalTicks, requested);
        if (delta !== this.ghostDelta) {
          this.ghostDelta = delta;
          this.onDirty();
        }
        break;
      }
      case "thumb": {
        const total = MAX_TICKS;
        const ratio = (e.clientX - this.scrollbar.getBoundingClientRect().left) / this.scrollbar.clientWidth;
        const viewTicks = this.drag.width / this.store.state.pxPerTick;
        const scrollTick = Math.max(0, Math.min(total - viewTicks, ratio * total - viewTicks / 2));
        this.store.update({ scrollTick });
        this.onDirty();
        break;
      }
      default:
        break;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (this.drag.kind === "box") {
      const s = this.store.state;
      if (s.selectionStartTick !== null && s.selectionEndTick !== null) {
        const a = Math.min(s.selectionStartTick, s.selectionEndTick);
        const b = Math.max(s.selectionStartTick, s.selectionEndTick);
        const inside = markerTicks(s.doc.markers).filter((t) => t >= a && t <= b);
        const previous = normalizeSelection(this.drag.previousSelection);
        let selected: number[];
        let mode: string;
        if (e.shiftKey) {
          selected = [...new Set([...previous, ...inside])].sort((x, y) => x - y);
          mode = "add";
        } else if (e.ctrlKey) {
          const previousSet = new Set(previous);
          const insideSet = new Set(inside);
          selected = [
            ...previous.filter((t) => !insideSet.has(t)),
            ...inside.filter((t) => !previousSet.has(t)),
          ].sort((x, y) => x - y);
          mode = "toggle";
        } else {
          selected = inside;
          mode = "replace";
        }
        this.store.update({ selectedTicks: selected });
        this.store.setStatus(
          selected.length
            ? `Box select (${mode}): ${selected.length} marker(s) selected`
            : `Box select (${mode}): no markers inside`
        );
      }
    } else if (this.drag.kind === "move") {
      const requestedDelta = this.ghostDelta;
      this.ghostDelta = 0;
      if (requestedDelta !== 0) {
        const doc = this.store.state.doc;
        const applied = doc.moveSelection(this.drag.originalTicks, requestedDelta);
        if (applied !== requestedDelta) {
          this.store.setStatus(
            `Move clamped to ${applied} tick(s) to keep the group on the timeline`
          );
        } else {
          this.store.setStatus(`Moved ${this.drag.originalTicks.length} marker(s) by ${applied} ticks`);
        }
        this.store.update({
          selectedTicks: normalizeSelection(this.drag.originalTicks.map((t) => t + applied)),
        });
      }
    }
    this.drag = { kind: "none" };
    this.onDirty();
  };

  private onWaveWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey) {
      const tick = this.eventTick(e);
      this.store.zoomAt(tick, e.deltaY < 0 ? 1.25 : 1 / 1.25);
    } else {
      const dx = (e.deltaY + e.deltaX) / this.store.state.pxPerTick;
      const scrollTick = Math.max(0, this.store.state.scrollTick + dx);
      this.store.update({ scrollTick });
    }
    this.onDirty();
  };

  private onRulerMouseDown = (e: MouseEvent): void => {
    const rect = this.ruler.getBoundingClientRect();
    const { scrollTick, pxPerTick } = this.viewMetrics();
    const tick = this.clampedTick(this.view.xToTick(e.clientX - rect.left, scrollTick, pxPerTick));
    this.store.update({ cursorTick: this.store.snapTick(tick) });
    const s = this.store.state;
    if (s.source) {
      this.onSeek(
        tickToSampleExport(this.store.state.cursorTick, {
          bpm: s.doc.bpm,
          shift: s.doc.shift,
          sampleRate: s.source.sampleRate,
        })
      );
    }
    this.onDirty();
  };

  private onRulerWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.ruler.getBoundingClientRect();
    const { scrollTick, pxPerTick } = this.viewMetrics();
    const tick = this.view.xToTick(e.clientX - rect.left, scrollTick, pxPerTick);
    this.store.zoomAt(tick, e.deltaY < 0 ? 1.25 : 1 / 1.25);
    this.onDirty();
  };

  private onOverviewMouseDown = (e: MouseEvent): void => {
    const rect = this.overview.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / this.overview.clientWidth;
    const width = this.waveWrap.clientWidth;
    const viewTicks = width / this.store.state.pxPerTick;
    const scrollTick = Math.max(0, Math.min(MAX_TICKS - viewTicks, ratio * MAX_TICKS - viewTicks / 2));
    this.store.update({ scrollTick });
    this.onDirty();
  };

  private onThumbMouseDown = (e: MouseEvent): void => {
    e.stopPropagation();
    this.drag = { kind: "thumb", anchorX: e.clientX, anchorScroll: this.store.state.scrollTick, width: this.waveWrap.clientWidth };
  };

  private onScrollbarMouseDown = (e: MouseEvent): void => {
    const rect = this.scrollbar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / this.scrollbar.clientWidth;
    const width = this.waveWrap.clientWidth;
    const viewTicks = width / this.store.state.pxPerTick;
    const scrollTick = Math.max(0, Math.min(MAX_TICKS - viewTicks, ratio * MAX_TICKS - viewTicks / 2));
    this.store.update({ scrollTick });
    this.onDirty();
  };

  /** Current ghost delta while a marker drag is in progress. */
  currentGhost(): { ticks: number[]; delta: number } | undefined {
    if (this.drag.kind !== "move" || this.ghostDelta === 0) return undefined;
    return { ticks: this.drag.originalTicks, delta: this.ghostDelta };
  };
}
