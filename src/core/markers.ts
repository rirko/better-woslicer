/**
 * Marker document model and editing operations: place/remove, selection,
 * group-preserving multi-select drag, selection copy/cut/paste, quantize,
 * measure copy/paste (legacy compatibility), whole-map shift and bounded
 * undo/redo. Pure module — no Electron, no DOM.
 *
 * The document is the 49152-entry marker bitmap (Uint8Array), matching the
 * .wos representation 1:1 so save/load never reinterprets data.
 *
 * Two independent clipboards exist by design:
 *  - the internal selection clipboard (relative tick offsets, this module),
 *  - the BMSE system clipboard (core/bmse.ts, written via Electron IPC).
 * They never share state.
 */

import { MAX_TICKS, MEASURE_TICKS } from "./timebase.js";
import { markerTicks } from "./wos.js";

/** Normalizes a selection: deduplicated, sorted ascending, in-range ticks. */
export function normalizeSelection(ticks: readonly number[]): number[] {
  return [...new Set(ticks)].filter((t) => Number.isInteger(t) && t >= 0 && t < MAX_TICKS).sort((a, b) => a - b);
}

/** Relative offsets of `ticks` from their minimum (origin becomes 0). */
export function selectionToOffsets(ticks: readonly number[]): number[] {
  const sorted = normalizeSelection(ticks);
  if (!sorted.length) return [];
  const origin = sorted[0];
  return sorted.map((t) => t - origin);
}

/** Target ticks when an offset clipboard is pasted at `targetTick`. */
export function offsetsToTargets(offsets: readonly number[], targetTick: number): number[] {
  return [...offsets].map((o) => o + targetTick).sort((a, b) => a - b);
}

/**
 * Clamps a group delta so that EVERY tick stays inside [0, MAX_TICKS).
 * The whole group shares one delta, so relative spacing can never break.
 */
export function clampGroupDelta(ticks: readonly number[], delta: number): number {
  const sorted = normalizeSelection(ticks);
  if (!sorted.length) return 0;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return Math.max(-min, Math.min(MAX_TICKS - 1 - max, delta));
}

export type PasteCheck =
  | { ok: true; ticks: number[] }
  | { ok: false; reason: string };

/**
 * Pure paste resolution: computes target ticks and validates the WHOLE group.
 * Rejects when any target falls outside the timeline or lands on an existing
 * marker that is not part of the pasted group itself (overlap inside the
 * group is impossible because offsets are unique).
 */
export function resolvePaste(
  offsets: readonly number[],
  targetTick: number,
  occupied: ReadonlySet<number>,
  selfTicks: ReadonlySet<number>
): PasteCheck {
  if (!offsets.length) return { ok: false, reason: "clipboard is empty" };
  if (!Number.isInteger(targetTick)) return { ok: false, reason: "paste position must be an integer tick" };
  const targets = offsetsToTargets(offsets, targetTick);
  for (const t of targets) {
    if (t < 0 || t >= MAX_TICKS) {
      return { ok: false, reason: `paste rejected: marker would land at tick ${t}, outside the timeline` };
    }
    if (occupied.has(t) && !selfTicks.has(t)) {
      return { ok: false, reason: `paste rejected: tick ${t} already has a marker` };
    }
  }
  return { ok: true, ticks: targets };
}

export class MarkerDoc {
  markers: Uint8Array;
  bpm: number;
  shift: number;
  fadeoutMs: number;
  noisegateDb: number;

  private undoStack: Uint8Array[] = [];
  private redoStack: Uint8Array[] = [];

  constructor(
    bpm = 120,
    shift = 0,
    fadeoutMs = 0,
    noisegateDb = -48
  ) {
    this.markers = new Uint8Array(MAX_TICKS);
    this.bpm = bpm;
    this.shift = shift;
    this.fadeoutMs = fadeoutMs;
    this.noisegateDb = noisegateDb;
  }

  private pushUndo(): void {
    this.undoStack.push(this.markers.slice());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.markers.slice());
    this.markers = prev;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.markers.slice());
    this.markers = next;
    return true;
  }

  /** Replaces the bitmap without touching the undo stacks (load path). */
  replaceBitmap(markers: Uint8Array): void {
    if (markers.length !== MAX_TICKS) {
      throw new RangeError(`bitmap must have ${MAX_TICKS} entries`);
    }
    this.markers = markers.slice();
  }

  toggleMarker(tick: number): boolean {
    if (tick < 0 || tick >= MAX_TICKS) return false;
    this.pushUndo();
    this.markers[tick] = this.markers[tick] ? 0 : 1;
    return true;
  }

  setMarker(tick: number, value: boolean): boolean {
    if (tick < 0 || tick >= MAX_TICKS) return false;
    const next = value ? 1 : 0;
    if (this.markers[tick] === next) return false;
    this.pushUndo();
    this.markers[tick] = next;
    return true;
  }

  clearAll(): boolean {
    if (!markerTicks(this.markers).length) return false;
    this.pushUndo();
    this.markers.fill(0);
    return true;
  }

  /** Replaces the whole bitmap with the given tick set (undoable). */
  setTicks(ticks: readonly number[]): boolean {
    const clean = [...new Set(ticks)].filter((t) => t >= 0 && t < MAX_TICKS);
    this.pushUndo();
    this.markers.fill(0);
    for (const t of clean) this.markers[t] = 1;
    return true;
  }

  /** Shifts every marker by `delta` ticks, dropping markers that fall outside. */
  shiftAll(delta: number): boolean {
    const ticks = markerTicks(this.markers);
    if (!ticks.length) return false;
    this.pushUndo();
    this.markers.fill(0);
    for (const t of ticks) {
      const next = t + delta;
      if (next >= 0 && next < MAX_TICKS) this.markers[next] = 1;
    }
    return true;
  }

  /** Sorted marker ticks. */
  ticks(): number[] {
    return markerTicks(this.markers);
  }

  /* ------------------------------------------------------------------ */
  /* Batch edits: paint strokes, erase sweeps, band detect               */
  /* Each batch is ONE undo entry, never one per tick.                   */
  /* ------------------------------------------------------------------ */

  /** Snapshot for gesture-style edits (paint / erase); restore on cancel. */
  snapshot(): Uint8Array {
    return this.markers.slice();
  }

  restoreSnapshot(snapshot: Uint8Array): void {
    if (snapshot.length !== MAX_TICKS) throw new RangeError(`snapshot must have ${MAX_TICKS} entries`);
    this.markers = snapshot.slice();
  }

  /** Commits `before` as a single undo entry when the bitmap actually changed. */
  commitSnapshot(before: Uint8Array): boolean {
    if (before.length !== MAX_TICKS) throw new RangeError(`snapshot must have ${MAX_TICKS} entries`);
    let changed = false;
    for (let i = 0; i < MAX_TICKS; i++) {
      if (this.markers[i] !== before[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    this.undoStack.push(before.slice());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  /** Adds many ticks in one undo step; returns how many were newly set. */
  addTicks(ticks: readonly number[]): number {
    const unique = normalizeSelection(ticks).filter((t) => this.markers[t] !== 1);
    if (!unique.length) return 0;
    this.pushUndo();
    for (const t of unique) this.markers[t] = 1;
    return unique.length;
  }

  /** Removes many ticks in one undo step; returns how many were removed. */
  removeTicks(ticks: readonly number[]): number {
    const unique = normalizeSelection(ticks).filter((t) => this.markers[t] === 1);
    if (!unique.length) return 0;
    this.pushUndo();
    for (const t of unique) this.markers[t] = 0;
    return unique.length;
  }

  /**
   * Quantizes every marker to the nearest multiple of `grid` ticks.
   * Collisions after snapping collapse into one marker (first wins) unless
   * `resolveCollisions` is false, in which case markers may merge implicitly
   * by sharing a tick.
   */
  /**
   * Copies one measure (192 ticks) of markers into a measure clipboard.
   * `measure` is clamped to the 256-measure timeline.
   */
  copyMeasure(measure: number): Uint8Array {
    const base = this.measureBase(measure);
    const clip = new Uint8Array(MEASURE_TICKS);
    for (let i = 0; i < MEASURE_TICKS; i++) clip[i] = this.markers[base + i];
    return clip;
  }

  /** Cuts one measure into the measure clipboard (copy + clear). */
  cutMeasure(measure: number): Uint8Array {
    const clip = this.copyMeasure(measure);
    const base = this.measureBase(measure);
    this.pushUndo();
    for (let i = 0; i < MEASURE_TICKS; i++) this.markers[base + i] = 0;
    return clip;
  }

  /** Pastes a measure clipboard at `measure`. */
  pasteMeasure(measure: number, clip: Uint8Array): boolean {
    if (clip.length !== MEASURE_TICKS) {
      throw new RangeError("measure clipboard must have 192 entries");
    }
    const base = this.measureBase(measure);
    this.pushUndo();
    for (let i = 0; i < MEASURE_TICKS; i++) this.markers[base + i] = clip[i];
    return true;
  }

  private measureBase(measure: number): number {
    const clamped = Math.min(255, Math.max(0, Math.floor(measure)));
    return clamped * MEASURE_TICKS;
  }

  /* ------------------------------------------------------------------ */
  /* Selection model (Ctrl+C/X/V)                                        */
  /* ------------------------------------------------------------------ */

  /** Internal selection clipboard: relative offsets, origin = 0. */
  selectionClipboard: number[] | null = null;
  /** Absolute tick of the clipboard origin (smallest source tick). Public so
   * tests and state restore can set clipboard + origin together. */
  clipboardOrigin: number | null = null;

  /** Copies the selected markers as relative offsets (empty if no selection). */
  copySelection(selected: readonly number[]): number[] {
    const sorted = normalizeSelection(selected);
    const offsets = selectionToOffsets(sorted);
    this.selectionClipboard = offsets.length ? offsets : null;
    this.clipboardOrigin = offsets.length ? sorted[0] : null;
    return offsets;
  }

  /**
   * The ticks the clipboard may legally overwrite: the group itself, but ONLY
   * when pasting back at the clipboard's own origin (idempotent re-paste).
   * Anywhere else, occupied targets are conflicts.
   */
  private selfTicksFor(targetTick: number): ReadonlySet<number> {
    if (this.clipboardOrigin === null || this.selectionClipboard === null) return new Set();
    if (targetTick !== this.clipboardOrigin) return new Set();
    return new Set(offsetsToTargets(this.selectionClipboard, targetTick));
  }

  /** Cuts the selected markers (copy + undoable delete). */
  cutSelection(selected: readonly number[]): number[] {
    const offsets = this.copySelection(selected);
    if (!offsets.length) return offsets;
    const sorted = normalizeSelection(selected);
    this.pushUndo();
    for (const t of sorted) this.markers[t] = 0;
    return offsets;
  }

  /** Whether the current clipboard can be pasted at `targetTick`. */
  canPasteAt(targetTick: number): boolean {
    if (!this.selectionClipboard) return false;
    const occupied = new Set(this.ticks());
    return resolvePaste(this.selectionClipboard, targetTick, occupied, this.selfTicksFor(targetTick)).ok;
  }

  /**
   * Pastes the selection clipboard with its origin at `targetTick`,
   * preserving relative spacing. The whole group is rejected (nothing is
   * written) on out-of-range targets or collisions with foreign markers.
   * Returns the pasted tick positions (for auto-selection), or null.
   */
  pasteSelection(targetTick: number): number[] | null {
    const offsets = this.selectionClipboard;
    if (!offsets) return null;
    const occupied = new Set(this.ticks());
    const check = resolvePaste(offsets, targetTick, occupied, this.selfTicksFor(targetTick));
    if (!check.ok) return null;
    this.pushUndo();
    for (const t of check.ticks) this.markers[t] = 1;
    return check.ticks;
  }

  /** The reason a paste at `targetTick` would be rejected (for status text). */
  pasteRejectReason(targetTick: number): string {
    const offsets = this.selectionClipboard;
    if (!offsets) return "selection clipboard is empty";
    const occupied = new Set(this.ticks());
    const check = resolvePaste(offsets, targetTick, occupied, this.selfTicksFor(targetTick));
    return check.ok ? "" : check.reason;
  }

  /* ------------------------------------------------------------------ */
  /* Selection-scoped quantize / group move                              */
  /* ------------------------------------------------------------------ */

  /**
   * Quantizes ONLY the selected markers to the nearest multiple of `grid`.
   * The rest of the map is untouched. Collisions with non-selected markers
   * merge (the selected marker wins the tick). No selection: no-op.
   */
  quantizeSelection(selected: readonly number[], grid: number): boolean {
    if (!Number.isInteger(grid) || grid <= 0 || grid > MAX_TICKS) {
      throw new RangeError(`grid must be a positive integer <= ${MAX_TICKS}`);
    }
    const sorted = normalizeSelection(selected);
    if (!sorted.length) return false;
    const moved = sorted.filter((t) => Math.round(t / grid) * grid !== t);
    if (!moved.length) return false;
    this.pushUndo();
    for (const t of sorted) this.markers[t] = 0;
    for (const t of sorted) {
      const target = Math.min(MAX_TICKS - 1, Math.max(0, Math.round(t / grid) * grid));
      this.markers[target] = 1;
    }
    return true;
  }

  /**
   * Moves a selection by `delta` ticks with a GROUP clamp: the delta is
   * limited once for the whole group so relative spacing is preserved even
   * at the timeline boundaries. Returns the actually applied delta (0 when
   * there is nothing to move).
   */
  moveSelection(selected: readonly number[], delta: number): number {
    const sorted = normalizeSelection(selected);
    if (!sorted.length || delta === 0) return 0;
    const applied = clampGroupDelta(sorted, delta);
    if (applied === 0) return 0;
    this.pushUndo();
    for (const t of sorted) this.markers[t] = 0;
    for (const t of sorted) this.markers[t + applied] = 1;
    return applied;
  }
}

/** Returns the last marker tick at or before `tick`, or -1. */
export function markerAtOrBefore(ticks: readonly number[], tick: number): number {
  let result = -1;
  for (const t of ticks) {
    if (t <= tick) result = t;
    else break;
  }
  return result;
}

/** Returns the index of the slice that starts at or before `tick`, or -1. */
export function sliceIndexAtOrBefore(ticks: readonly number[], tick: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid] <= tick) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
