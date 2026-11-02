/**
 * Keyboard semantics.
 *
 * The decision logic lives in the pure `resolveAction` function (unit-tested,
 * no DOM) so focus gating rules are verifiable without launching the app.
 *
 * Preserved from the original woslicerIII:
 *  - Arrow keys  : move the cursor by grid (Left/Right) or by measure (Up/Down)
 *  - Z           : place / remove the cut line at the cursor
 *  - P           : preview the slice at the cursor
 *  - O           : preview the previous slice
 *  - Q / W       : cycle the grid size down / up
 *  - M           : export all slices
 *  - V / B       : BMSE clipboard out / in
 *  - A / S       : output clip start number -1 / +1
 *  - N           : toggle FF numbering rule
 *  - T / Y       : save / load .wos
 *  - C           : clear all cut lines
 *  - 7 / 8       : shift all cut lines -1 / +1 tick
 *  - Ctrl+F      : paste one measure of markers (legacy alias)
 *
 * New selection model:
 *  - Ctrl+C / Ctrl+X / Ctrl+V : copy / cut / paste the SELECTED markers as a
 *    relative group (origin = smallest selected tick). Pasting anchors the
 *    group origin at the cursor tick, keeps relative spacing, rejects the
 *    whole group on out-of-range or collision, and auto-selects the result.
 *  - Shift+ArrowLeft / ArrowRight : cursor by single tick
 *  - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y : undo / redo
 *  - Space : play / pause in every state (never drops a marker any more).
 *  - Enter : place a break point WITHOUT touching the play state — playing:
 *    marker at the tick computed back from the playhead sample; stopped:
 *    marker at the cursor and the playhead sample synced to the final
 *    position. The tick resolves through the Snap toggle + Grid density
 *    (nearest grid tick); holding Alt bypasses snapping for that placement.
 *    This repurposes the original's Enter preview; preview stays on P.
 *  - [ / ] : monitor playback rate down / up through the frozen ladder
 *    0.25x / 0.5x / 0.75x / 1.0x / 1.5x, clamped at the endpoints.
 *  - Esc : clear selection
 *
 * Focused inputs, selects, textareas and buttons keep their native key
 * behaviour (Space/Enter activate a button).
 */

import { MAX_TICKS, MEASURE_TICKS } from "../core/timebase.js";
import { Store } from "./store.js";

export type FocusKind = "input" | "select" | "textarea" | "button" | "other";

export type ActionId =
  | "undo"
  | "redo"
  | "select-copy"
  | "select-cut"
  | "select-paste"
  | "measure-paste"
  | "export-slice"
  | "export-all"
  | "save-wos"
  | "load-wos"
  | "toggle-marker"
  | "preview"
  | "preview-previous"
  | "grid-down"
  | "grid-up"
  | "bmse-out"
  | "bmse-in"
  | "clip-number-down"
  | "clip-number-up"
  | "toggle-ff"
  | "clear-markers"
  | "shift-all-minus"
  | "shift-all-plus"
  | "play-pause"
  | "place-breakpoint"
  | "rate-down"
  | "rate-up"
  | "cursor-left-tick"
  | "cursor-right-tick"
  | "cursor-left-grid"
  | "cursor-right-grid"
  | "cursor-up-measure"
  | "cursor-down-measure"
  | "zoom-in"
  | "zoom-out"
  | "clear-selection";

export interface KeyEventShape {
  ctrl: boolean;
  shift: boolean;
  key: string;
}

/**
 * Structural event type so this module stays DOM-lib free and testable from
 * plain Node (the renderer passes real KeyboardEvents).
 */
export interface KeyEventLike {
  target: unknown;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
  preventDefault(): void;
}

/** Classifies an event target into the focus kinds the gate cares about. */
export function classifyTarget(target: unknown): FocusKind {
  if (typeof target !== "object" || target === null || !("tagName" in target)) return "other";
  const tag = String((target as { tagName: unknown }).tagName).toUpperCase();
  switch (tag) {
    case "INPUT":
      return "input";
    case "SELECT":
      return "select";
    case "TEXTAREA":
      return "textarea";
    case "BUTTON":
      return "button";
    default:
      return "other";
  }
}

/**
 * Pure keyboard decision. Returns the action id, or null when the event must
 * keep native behaviour (form fields, buttons receiving Space/Enter, and
 * unhandled keys).
 *
 * Focus gating rules:
 *  - input / select / textarea: everything stays native, no actions at all.
 *  - button: Space and Enter keep activating the button; other shortcuts stay
 *    available so a focused button never eats Z or the arrows.
 *  - other (waveform editor, page body): full shortcut set, including the
 *    Space play/pause and Enter break-point actions.
 */
export function resolveAction(focus: FocusKind, event: KeyEventShape): ActionId | null {
  if (focus === "input" || focus === "select" || focus === "textarea") return null;

  const { ctrl, shift, key } = event;

  if (focus === "button" && (key === " " || key === "Enter")) return null;

  if (ctrl) {
    switch (key.toLowerCase()) {
      case "z":
        return shift ? "redo" : "undo";
      case "y":
        return "redo";
      case "c":
        return "select-copy";
      case "x":
        return "select-cut";
      case "v":
        return "select-paste";
      case "f":
        return "measure-paste";
      case "e":
        return shift ? "export-all" : "export-slice";
      case "s":
        return "save-wos";
      default:
        return null;
    }
  }

  switch (key) {
    case " ":
      return "play-pause";
    case "Enter":
    case ",":
    case ".":
      return "place-breakpoint";
    case "z":
      return "toggle-marker";
    case "p":
      return "preview";
    case "o":
      return "preview-previous";
    case "[":
      return "rate-down";
    case "]":
      return "rate-up";
    case "q":
      return "grid-down";
    case "w":
      return "grid-up";
    case "m":
      return "export-all";
    case "v":
      return "bmse-out";
    case "b":
      return "bmse-in";
    case "a":
      return "clip-number-down";
    case "s":
      return "clip-number-up";
    case "n":
      return "toggle-ff";
    case "t":
      return "save-wos";
    case "y":
      return "load-wos";
    case "c":
      return "clear-markers";
    case "7":
      return "shift-all-minus";
    case "8":
      return "shift-all-plus";
    case "Escape":
      return "clear-selection";
    case "ArrowLeft":
      return shift ? "cursor-left-tick" : "cursor-left-grid";
    case "ArrowRight":
      return shift ? "cursor-right-tick" : "cursor-right-grid";
    case "ArrowUp":
      return "cursor-up-measure";
    case "ArrowDown":
      return "cursor-down-measure";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    default:
      return null;
  }
}

export interface KeyActions {
  toggleMarkerAtCursor(): void;
  previewAtCursor(): void;
  previewPrevious(): void;
  playPause(): void;
  /**
   * Enter action. `bypassSnap` (Alt held) drops the marker at the exact
   * position; otherwise the tick snaps to the current grid when Snap is on.
   */
  placeBreakpoint(bypassSnap?: boolean): void;
  rateDown(): void;
  rateUp(): void;
  exportAll(): void;
  exportSliceAtCursor(): void;
  bmseOut(): void;
  bmseIn(): void;
  saveWos(): void;
  loadWos(): void;
  clearMarkers(): void;
  undo(): void;
  redo(): void;
  setClipNumber(n: number): void;
  toggleFf(): void;
  shiftAll(delta: number): void;
  selectCopy(): void;
  selectCut(): void;
  selectPaste(): void;
  quantizeSelection(): void;
  /** Esc: cancels an in-progress paint/erase gesture, else clears selection. */
  clearSelection(): void;
  measureCopy(): void;
  measureCut(): void;
  measurePaste(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Redraw hook for actions that mutate the document without their own view update. */
  zoomRefresh(): void;
}

/**
 * Grid sizes cycled by Q / W, in divisions of one measure. Coarser than the
 * original ladder: 2 = half-measure cell, 1 = the whole measure as one cell.
 * The command-bar Grid select (index.html) must list the exact same values
 * (tests/keys.test.ts keeps the two in sync).
 */
export const GRID_CYCLE = [1, 2, 4, 6, 8, 12, 16, 24, 32];

export function handleKeyDown(store: Store, actions: KeyActions, e: KeyEventLike): void {
  const action = resolveAction(
    classifyTarget(e.target),
    { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, key: e.key }
  );
  if (!action) return;
  e.preventDefault();

  const s = store.state;
  switch (action) {
    case "undo":
      if (s.doc.undo()) store.setStatus("Undo");
      else store.setStatus("Nothing to undo");
      actions.zoomRefresh();
      return;
    case "redo":
      if (s.doc.redo()) store.setStatus("Redo");
      else store.setStatus("Nothing to redo");
      actions.zoomRefresh();
      return;
    case "select-copy":
      actions.selectCopy();
      return;
    case "select-cut":
      actions.selectCut();
      return;
    case "select-paste":
      actions.selectPaste();
      return;
    case "measure-paste":
      actions.measurePaste();
      return;
    case "export-slice":
      actions.exportSliceAtCursor();
      return;
    case "export-all":
      actions.exportAll();
      return;
    case "save-wos":
      actions.saveWos();
      return;
    case "toggle-marker":
      actions.toggleMarkerAtCursor();
      return;
    case "preview":
      actions.previewAtCursor();
      return;
    case "preview-previous":
      actions.previewPrevious();
      return;
    case "grid-down":
      cycleGrid(store, -1);
      return;
    case "grid-up":
      cycleGrid(store, +1);
      return;
    case "bmse-out":
      actions.bmseOut();
      return;
    case "bmse-in":
      actions.bmseIn();
      return;
    case "clip-number-down":
      actions.setClipNumber(s.clipStartNumber - 1);
      return;
    case "clip-number-up":
      actions.setClipNumber(s.clipStartNumber + 1);
      return;
    case "toggle-ff":
      actions.toggleFf();
      return;
    case "load-wos":
      actions.loadWos();
      return;
    case "clear-markers":
      actions.clearMarkers();
      return;
    case "shift-all-minus":
      actions.shiftAll(-1);
      return;
    case "shift-all-plus":
      actions.shiftAll(+1);
      return;
    case "play-pause":
      actions.playPause();
      return;
    case "place-breakpoint":
      // Alt travels with the event: held = free placement, bypassing Snap.
      actions.placeBreakpoint(e.altKey);
      return;
    case "rate-down":
      actions.rateDown();
      return;
    case "rate-up":
      actions.rateUp();
      return;
    case "clear-selection":
      actions.clearSelection();
      return;
    case "cursor-left-tick":
    case "cursor-right-tick":
    case "cursor-left-grid":
    case "cursor-right-grid": {
      const dir = action.endsWith("left") ? -1 : 1;
      const step = action.endsWith("tick") ? 1 : s.grid;
      store.update({ cursorTick: Math.max(0, Math.min(MAX_TICKS - 1, s.cursorTick + dir * step)) });
      return;
    }
    case "cursor-up-measure":
    case "cursor-down-measure": {
      const dir = action === "cursor-up-measure" ? -1 : 1;
      store.update({ cursorTick: Math.max(0, Math.min(MAX_TICKS - 1, s.cursorTick + dir * MEASURE_TICKS)) });
      return;
    }
    case "zoom-in":
      actions.zoomIn();
      return;
    case "zoom-out":
      actions.zoomOut();
      return;
  }
}

function cycleGrid(store: Store, dir: number): void {
  const current = store.state.grid;
  const index = GRID_CYCLE.indexOf(current);
  const nextIndex = Math.max(0, Math.min(GRID_CYCLE.length - 1, (index < 0 ? 2 : index) + dir));
  const next = GRID_CYCLE[nextIndex];
  if (next !== current) {
    store.update({ grid: next });
    store.setStatus(`Grid: ${next} ticks`);
  }
}
