import { shallowRef } from 'vue';
import type { EditorStore } from '../slicing/editor-store';
import { clampGroupDelta } from '../core/markers';
import { markerTicks } from '../core/wos';
import { gridStepTicks } from '../core/gridlines';
import { MAX_TICKS, resolveBreakpointTick } from '../core/timebase';
import type { Ghost } from './render';

export interface TimelinePointer { x: number; y: number; button: number; altKey: boolean; shiftKey: boolean; ctrlKey: boolean }
type Selection = { ticks: number[]; start: number | null; end: number | null };
type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending' | 'paint'; revision: number; bitmap: Uint8Array; selection: Selection; anchor: TimelinePointer; anchorTick: number; lastTick: number; lastX: number; changed: Set<number> }
  | { kind: 'erase'; revision: number; bitmap: Uint8Array; selection: Selection; lastTick: number; count: number }
  | { kind: 'move'; revision: number; anchorTick: number; ticks: number[]; selection: Selection }
  | { kind: 'box'; revision: number; anchorTick: number; selection: Selection }
  | { kind: 'pan'; anchorX: number; scroll: number };

/** Gesture transaction state, independent of DOM listeners and canvas drawing. */
export function createTimelineGestures(editor: EditorStore) {
  let gesture: Gesture = { kind: 'idle' };
  const ghost = shallowRef<Ghost>();
  const cursor = shallowRef('copy');
  const unregister = editor.registerDraftCancellation(() => { cancel(); });
  function bitmap(): Uint8Array {
    const value = new Uint8Array(MAX_TICKS);
    for (const tick of editor.ticks) value[tick] = 1;
    return value;
  }
  const tickAt = (x: number) => editor.scrollTick + x / editor.pxPerTick;
  const clamped = (tick: number) => Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick)));
  const paintTick = (point: TimelinePointer) => resolveBreakpointTick(tickAt(point.x), editor.snap, gridStepTicks(editor.grid), point.altKey);
  const selection = (): Selection => ({ ticks: [...editor.selectedTicks], start: editor.selectionStartTick, end: editor.selectionEndTick });
  function restoreSelection(value: Selection): void { editor.setSelectedTicks(value.ticks); editor.setSelection(value.start, value.end); }
  function near(x: number): number | undefined {
    const target = tickAt(x);
    let nearest: number | undefined, distance = 10 / editor.pxPerTick;
    for (const tick of editor.ticks) if (Math.abs(tick - target) <= distance) { nearest = tick; distance = Math.abs(tick - target); }
    return nearest;
  }
  function paint(tick: number, changed: Set<number>, draft: Uint8Array): void {
    if (!editor.legalTick(tick) || draft[tick] === 1) return;
    draft[tick] = 1; changed.add(tick);
  }
  function paintSegment(from: number, to: number, point: TimelinePointer, changed: Set<number>, draft: Uint8Array): void {
    const step = gridStepTicks(editor.grid);
    if (editor.snap && !point.altKey && step > 0) {
      for (let tick = Math.min(from, to); tick <= Math.max(from, to); tick += step) paint(Math.round(tick), changed, draft);
    } else paint(to, changed, draft);
  }
  function erase(first: number, last: number, draft: Uint8Array): number {
    const radius = 8 / editor.pxPerTick;
    const hits = markerTicks(draft).filter(tick => tick >= Math.min(first, last) - radius && tick <= Math.max(first, last) + radius);
    for (const tick of hits) draft[tick] = 0;
    editor.setPreviewTicks(markerTicks(draft));
    return hits.length;
  }
  function begin(point: TimelinePointer): void {
    cancel();
    if (point.button === 1) { gesture = { kind: 'pan', anchorX: point.x, scroll: editor.scrollTick }; cursor.value = 'grabbing'; return; }
    if (point.button === 2) {
      const tick = tickAt(point.x);
      const draft = bitmap();
      gesture = { kind: 'erase', revision: editor.docRevision, bitmap: draft, selection: selection(), lastTick: tick, count: erase(tick, tick, draft) };
      cursor.value = 'no-drop'; return;
    }
    if (point.button !== 0) return;
    if (point.shiftKey || point.ctrlKey) {
      const tick = clamped(tickAt(point.x));
      gesture = { kind: 'box', revision: editor.docRevision, anchorTick: tick, selection: selection() };
      editor.setSelection(tick, tick); editor.setSelectedTicks([]); cursor.value = 'crosshair';
      editor.setStatus('boxSelectHint'); return;
    }
    const hit = near(point.x);
    if (hit !== undefined) {
      const previous = selection();
      const ticks = editor.selectedTicks.includes(hit) ? [...editor.selectedTicks] : [hit];
      gesture = { kind: 'move', revision: editor.docRevision, anchorTick: tickAt(point.x), ticks, selection: previous };
      editor.setSelectedTicks(ticks); editor.setSelection(null, null); cursor.value = 'ew-resize';
      editor.setStatus('draggingMarkers', { count: ticks.length }); return;
    }
    const tick = paintTick(point);
    gesture = { kind: 'pending', revision: editor.docRevision, bitmap: bitmap(), selection: selection(), anchor: point, anchorTick: tick, lastTick: tick, lastX: point.x, changed: new Set() };
    editor.setCursorTick(tick); cursor.value = 'copy';
  }
  function move(point: TimelinePointer): void {
    const current = gesture;
    switch (current.kind) {
      case 'idle': cursor.value = point.shiftKey || point.ctrlKey ? 'crosshair' : near(point.x) === undefined ? 'copy' : 'ew-resize'; break;
      case 'pan': editor.setScrollTick(current.scroll - (point.x - current.anchorX) / editor.pxPerTick); break;
      case 'pending':
      case 'paint': {
        if (current.kind === 'pending') {
          if (Math.hypot(point.x - current.anchor.x, point.y - current.anchor.y) < 3) break;
          current.kind = 'paint'; paint(current.anchorTick, current.changed, current.bitmap);
        }
        if ((!editor.snap || point.altKey) && Math.abs(point.x - current.lastX) < 2) break;
        const tick = paintTick(point);
        paintSegment(current.lastTick, tick, point, current.changed, current.bitmap);
        current.lastTick = tick; current.lastX = point.x;
        editor.setPreviewTicks(markerTicks(current.bitmap)); editor.setCursorTick(tick); editor.setStatus('paintingMarkers', { count: current.changed.size });
        break;
      }
      case 'erase': {
        const tick = tickAt(point.x); current.count += erase(current.lastTick, tick, current.bitmap); current.lastTick = tick;
        editor.setStatus('erasingMarkers', { count: current.count }); break;
      }
      case 'box': editor.setSelection(current.anchorTick, clamped(tickAt(point.x))); break;
      case 'move': {
        const raw = tickAt(point.x) - current.anchorTick, cell = gridStepTicks(editor.grid);
        const requested = editor.snap && !point.altKey && cell > 0 ? Math.round(raw / cell) * cell : Math.round(raw);
        let delta = clampGroupDelta(current.ticks, requested);
        if (editor.source && current.ticks.length) {
          // Use the same integer export boundary as marker placement (EOF is legal).
          let low = 0, high = MAX_TICKS - 1;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (editor.tickBeyondEnd(middle)) high = middle - 1; else low = middle;
          }
          delta = Math.max(-Math.min(...current.ticks), Math.min(delta, low - Math.max(...current.ticks)));
        }
        ghost.value = { ticks: current.ticks, delta }; break;
      }
    }
  }
  function end(point: TimelinePointer): void {
    const current = gesture;
    if ('revision' in current && current.revision !== editor.docRevision) { cancel(); return; }
    // Release the draft before entering the store's command/transaction gate.
    gesture = { kind: 'idle' }; editor.setPreviewTicks(null);
    switch (current.kind) {
      case 'pending':
      case 'paint': {
        if (current.kind === 'pending') paint(current.anchorTick, current.changed, current.bitmap);
        const committed = editor.setTicks(markerTicks(current.bitmap));
        editor.setStatus(committed ? 'paintedMarkers' : 'paintGestureNoop', { count: current.changed.size }); break;
      }
      case 'erase': {
        const committed = editor.setTicks(markerTicks(current.bitmap));
        editor.setStatus(committed ? 'erasedMarkers' : 'eraseGestureNoop', { count: current.count }); break;
      }
      case 'box': {
        const end = editor.selectionEndTick ?? current.anchorTick;
        const inside = editor.ticks.filter(tick => tick >= Math.min(current.anchorTick, end) && tick <= Math.max(current.anchorTick, end));
        const previous = current.selection.ticks;
        const selected = point.shiftKey ? [...new Set([...previous, ...inside])] : point.ctrlKey ? [...previous.filter(tick => !inside.includes(tick)), ...inside.filter(tick => !previous.includes(tick))] : inside;
        editor.setSelectedTicks(selected);
        const mode = point.shiftKey ? 'add' : point.ctrlKey ? 'toggle' : 'replace';
        editor.setStatus(selected.length ? 'boxSelectSelected' : 'boxSelectEmpty', { count: selected.length, mode }); break;
      }
      case 'move': {
        const delta = ghost.value?.delta ?? 0;
        if (delta) {
          const applied = clampGroupDelta(current.ticks, delta);
          editor.setTicks([...editor.ticks.filter(t => !current.ticks.includes(t)), ...current.ticks.map(t => t + applied)]);
          editor.setSelectedTicks(current.ticks.map(tick => tick + applied));
          editor.setStatus('movedMarkersBy', { count: current.ticks.length, delta: applied });
        }
        break;
      }
      case 'idle': case 'pan': break;
    }
    gesture = { kind: 'idle' }; ghost.value = undefined; cursor.value = 'copy';
  }
  function cancel(): boolean {
    const current = gesture;
    if (current.kind === 'idle') return false;
    if ('revision' in current && current.revision === editor.docRevision) restoreSelection(current.selection);
    if (current.kind === 'pan') editor.setScrollTick(current.scroll);
    gesture = { kind: 'idle' }; editor.setPreviewTicks(null); ghost.value = undefined; cursor.value = 'copy'; return true;
  }
  function wheel(x: number, deltaX: number, deltaY: number, zoom: boolean): void {
    if (zoom) editor.zoomAt(tickAt(x), deltaY < 0 ? 1.25 : 1 / 1.25);
    else editor.setScrollTick(editor.scrollTick + (deltaX + deltaY) / editor.pxPerTick);
  }
  return { begin, move, end, cancel, wheel, ghost, cursor, dispose: unregister };
}
