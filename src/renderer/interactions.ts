/**
 * Mouse interactions on the timeline (DEEPSEEK frozen spec):
 *
 *  - Left click / drag on empty space  : paint markers (single click = 1,
 *    drag = one per grid cell crossed). Alt bypasses Snap; with Snap off the
 *    paint is throttled to 2px so one sweep cannot create hundreds of points.
 *  - Left press on a cut point (<=10px): move the selection group (Alt = 1
 *    tick precision). Unselected marker: it becomes the selection first.
 *  - Right press / sweep               : erase markers within an 8px brush.
 *  - Shift/Ctrl + left drag            : box selection (Shift adds, Ctrl toggles).
 *  - Middle drag                       : pan.
 *  - Wheel                             : horizontal scroll; Ctrl+wheel zoom.
 *
 * Priority: Shift/Ctrl > marker hit > empty-space paint. A left press within
 * 3px is "pending" (nothing is written) so a click never turns into a stroke.
 * Paint and erase commit as ONE undo entry per gesture; Esc cancels and
 * restores the pre-gesture bitmap.
 */

import { gridStepTicks } from "../core/gridlines.js";
import { MAX_TICKS, resolveBreakpointTick, tickToSampleExport } from "../core/timebase.js";
import { markerTicks } from "../core/wos.js";
import { clampGroupDelta, normalizeSelection } from "../core/markers.js";
import { Store } from "./store.js";
import { TimelineView } from "./waveform.js";

type DragMode =
  | { kind: "none" }
  | {
      kind: "pendingPaint";
      anchorX: number;
      anchorY: number;
      anchorTick: number;
      before: Uint8Array;
      painted: Set<number>;
    }
  | { kind: "paint"; lastTick: number; lastX: number; before: Uint8Array; painted: Set<number> }
  | { kind: "erase"; before: Uint8Array; erased: number; lastX: number }
  | { kind: "box"; anchorTick: number; previousSelection: number[] }
  | { kind: "move"; anchorTick: number; originalTicks: number[] }
  | { kind: "pan"; anchorX: number; anchorScroll: number }
  | { kind: "thumb"; anchorX: number; anchorScroll: number; width: number };

/** Mouse hit distance (px) for grabbing a cut-point marker. */
const MARKER_HIT_PX = 10;
/** Left-press travel (px) before a click becomes a paint stroke. */
const PAINT_START_PX = 3;
/** Right-button erase brush radius (px). */
const ERASE_RADIUS_PX = 8;
/** With Snap off, painting advances only every N px to avoid point spam. */
const FREE_PAINT_MIN_PX = 2;

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

  /** Grid-resolved tick for painting (Alt bypasses Snap). */
  private paintTick(e: MouseEvent): number {
    const s = this.store.state;
    return resolveBreakpointTick(this.eventTick(e), s.snap, gridStepTicks(s.grid), e.altKey);
  }

  /** Nearest marker within MARKER_HIT_PX of the mouse, if any. */
  private markerNear(e: MouseEvent): number | undefined {
    const { scrollTick, pxPerTick } = this.viewMetrics();
    const x = (this.eventTick(e) - scrollTick) * pxPerTick;
    return markerTicks(this.store.state.doc.markers).find(
      (t) => Math.abs((t - scrollTick) * pxPerTick - x) <= MARKER_HIT_PX
    );
  }

  /** Writes one marker (no undo bookkeeping; the gesture commits the snapshot). */
  private paintAt(tick: number, painted: Set<number>): boolean {
    const doc = this.store.state.doc;
    if (tick < 0 || tick >= MAX_TICKS) return false;
    if (doc.markers[tick] === 1) return false;
    doc.markers[tick] = 1;
    painted.add(tick);
    return true;
  }

  /** Erases markers within the brush radius; returns how many were removed. */
  private eraseAt(e: MouseEvent): number {
    const doc = this.store.state.doc;
    const center = this.eventTick(e);
    const radiusTicks = ERASE_RADIUS_PX / this.store.state.pxPerTick;
    const hits = markerTicks(doc.markers).filter((t) => Math.abs(t - center) <= radiusTicks);
    for (const t of hits) doc.markers[t] = 0;
    return hits.length;
  }

  private onWaveMouseDown = (e: MouseEvent): void => {
    this.waveWrap.focus();
    if (e.button === 1) {
      this.drag = { kind: "pan", anchorX: e.clientX, anchorScroll: this.store.state.scrollTick };
      this.waveWrap.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }

    const s = this.store.state;

    // Right button: erase sweep (one undo per gesture).
    if (e.button === 2) {
      e.preventDefault();
      this.drag = { kind: "erase", before: s.doc.snapshot(), erased: 0, lastX: e.clientX };
      this.waveWrap.style.cursor = "no-drop";
      this.drag.erased += this.eraseAt(e);
      this.onDirty();
      return;
    }

    if (e.button !== 0) return;

    // Shift/Ctrl + left: box selection, exactly as before.
    if (e.shiftKey || e.ctrlKey) {
      const tick = this.clampedTick(this.eventTick(e));
      this.drag = { kind: "box", anchorTick: tick, previousSelection: [...s.selectedTicks] };
      this.store.update({ selectionStartTick: tick, selectionEndTick: tick, selectedTicks: [] });
      this.store.setStatus("boxSelectHint");
      this.onDirty();
      return;
    }

    // Left on a marker: move the selection group.
    const nearMarker = this.markerNear(e);
    if (nearMarker !== undefined) {
      const original = s.selectedTicks.includes(nearMarker) ? [...s.selectedTicks] : [nearMarker];
      this.drag = { kind: "move", anchorTick: this.eventTick(e), originalTicks: original };
      if (!s.selectedTicks.includes(nearMarker)) {
        this.store.update({ selectedTicks: original, selectionStartTick: null, selectionEndTick: null });
      }
      this.store.setStatus("draggingMarkers", { count: original.length });
      this.onDirty();
      return;
    }

    // Left on empty space: pending paint (a click adds one, a drag paints).
    const tick = this.paintTick(e);
    this.drag = {
      kind: "pendingPaint",
      anchorX: e.clientX,
      anchorY: e.clientY,
      anchorTick: tick,
      before: s.doc.snapshot(),
      painted: new Set<number>(),
    };
    this.store.update({ cursorTick: tick });
    this.onDirty();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.drag.kind === "none") this.updateHoverCursor(e);
    switch (this.drag.kind) {
      case "pan": {
        const dx = e.clientX - this.drag.anchorX;
        const scrollTick = Math.max(0, this.drag.anchorScroll - dx / this.store.state.pxPerTick);
        this.store.update({ scrollTick });
        this.onDirty();
        break;
      }
      case "pendingPaint": {
        const dx = e.clientX - this.drag.anchorX;
        const dy = e.clientY - this.drag.anchorY;
        if (Math.hypot(dx, dy) < PAINT_START_PX) break;
        // Promote to a stroke: anchor + current position.
        const before = this.drag.before;
        const painted = this.drag.painted;
        const doc = this.store.state.doc;
        doc.markers = before.slice();
        this.paintAt(this.drag.anchorTick, painted);
        const tick = this.paintTick(e);
        this.paintAt(tick, painted);
        this.drag = { kind: "paint", lastTick: tick, lastX: e.clientX, before, painted };
        this.store.update({ cursorTick: tick });
        this.store.setStatus("paintingMarkers", { count: painted.size });
        this.onDirty();
        break;
      }
      case "paint": {
        const tick = this.paintTick(e);
        if (tick === this.drag.lastTick) break;
        const freehand = !this.store.state.snap;
        if (freehand && Math.abs(e.clientX - this.drag.lastX) < FREE_PAINT_MIN_PX) break;
        if (this.paintAt(tick, this.drag.painted)) {
          this.store.update({ cursorTick: tick });
          this.store.setStatus("paintingMarkers", { count: this.drag.painted.size });
          this.onDirty();
        }
        this.drag.lastTick = tick;
        this.drag.lastX = e.clientX;
        break;
      }
      case "erase": {
        const erased = this.eraseAt(e);
        if (erased > 0) {
          this.drag.erased += erased;
          this.store.setStatus("erasingMarkers", { count: this.drag.erased });
          this.onDirty();
        }
        this.drag.lastX = e.clientX;
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
        const s = this.store.state;
        const cell = gridStepTicks(s.grid);
        const requested =
          s.snap && !e.altKey && cell > 0 ? Math.round(rawDelta / cell) * cell : Math.round(rawDelta);
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

  /**
   * Hover feedback: erase brush while the right button is held, ew-resize over
   * a cut point, box crosshair with Shift/Ctrl, paint cursor otherwise.
   */
  private updateHoverCursor(e: MouseEvent): void {
    const rect = this.waveWrap.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom;
    let cursor = "";
    if (inside) {
      if (this.markerNear(e) !== undefined) cursor = "ew-resize";
      else if (e.shiftKey || e.ctrlKey) cursor = "crosshair";
      else cursor = "copy";
    }
    if (this.waveWrap.style.cursor !== cursor) this.waveWrap.style.cursor = cursor;
  }

  private onMouseUp = (e: MouseEvent): void => {
    switch (this.drag.kind) {
      case "pendingPaint": {
        const doc = this.store.state.doc;
        const painted = new Set<number>();
        const changed = this.paintAt(this.drag.anchorTick, painted);
        if (changed) doc.commitSnapshot(this.drag.before);
        this.store.setStatus(
          changed
            ? { key: "addedMarkerAtTick", params: { tick: this.drag.anchorTick } }
            : { key: "markerAlreadyAtTick", params: { tick: this.drag.anchorTick } }
        );
        break;
      }
      case "paint": {
        const committed = this.store.state.doc.commitSnapshot(this.drag.before);
        this.store.setStatus(
          committed
            ? { key: "paintedMarkers", params: { count: this.drag.painted.size } }
            : "paintGestureNoop"
        );
        break;
      }
      case "erase": {
        const committed = this.store.state.doc.commitSnapshot(this.drag.before);
        this.store.setStatus(
          committed
            ? { key: "erasedMarkers", params: { count: this.drag.erased } }
            : "eraseGestureNoop"
        );
        break;
      }
      case "box": {
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
              ? { key: "boxSelectSelected", params: { mode, count: selected.length } }
              : { key: "boxSelectEmpty", params: { mode } }
          );
        }
        break;
      }
      case "move": {
        const requestedDelta = this.ghostDelta;
        this.ghostDelta = 0;
        if (requestedDelta !== 0) {
          const doc = this.store.state.doc;
          const applied = doc.moveSelection(this.drag.originalTicks, requestedDelta);
          if (applied !== requestedDelta) {
            this.store.setStatus("moveClamped", { count: applied });
          } else {
            this.store.setStatus("movedMarkersBy", { count: this.drag.originalTicks.length, delta: applied });
          }
          this.store.update({
            selectedTicks: normalizeSelection(this.drag.originalTicks.map((t) => t + applied)),
          });
        }
        break;
      }
      default:
        break;
    }
    this.drag = { kind: "none" };
    this.waveWrap.style.cursor = "";
    this.updateHoverCursor(e);
    this.onDirty();
  };

  /**
   * Esc: cancels an in-progress gesture, restoring the bitmap it started
   * from. Returns true when a gesture was cancelled (so the caller knows not
   * to also clear the selection).
   */
  cancelGesture(): boolean {
    const drag = this.drag;
    if (drag.kind === "pendingPaint" || drag.kind === "paint" || drag.kind === "erase") {
      this.store.state.doc.restoreSnapshot(drag.before);
      this.drag = { kind: "none" };
      this.waveWrap.style.cursor = "";
      this.onDirty();
      return true;
    }
    if (drag.kind === "box" || drag.kind === "move" || drag.kind === "pan" || drag.kind === "thumb") {
      this.drag = { kind: "none" };
      this.ghostDelta = 0;
      this.waveWrap.style.cursor = "";
      this.onDirty();
      return true;
    }
    return false;
  }

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
  }
}
