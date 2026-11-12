import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEditorStore } from '../../src/slicing/editor-store';
import { createTimelineGestures, type TimelinePointer } from '../../src/timeline/gestures';
import { createEmptyProject } from '../../src/project/codec';
import { createEditorActions } from '../../src/slicing/editor-actions';
import { captureEditorSession } from '../../src/workspace/session';

const point = (x: number, values: Partial<TimelinePointer> = {}): TimelinePointer => ({ x, y: 10, button: 0, altKey: false, shiftKey: false, ctrlKey: false, ...values });
beforeEach(() => setActivePinia(createPinia()));
function fixture(ticks: number[] = []) {
  const editor = useEditorStore(); editor.pxPerTick = 1;
  const doc = createEmptyProject(); doc.slicing.markers = ticks;
  editor.replaceDocument(doc);
  return { editor, gestures: createTimelineGestures(editor) };
}

describe('timeline gesture transactions', () => {
  it('keeps an unfinished stroke out of the document, history and recovery snapshot', () => {
    const { editor, gestures } = fixture([0]);
    const revision = editor.docRevision;
    gestures.begin(point(48)); gestures.move(point(120));
    expect(captureEditorSession(editor).project.slicing.markers).toEqual([0]);
    expect(editor.ticks).toEqual([0]);
    expect(editor.docRevision).toBe(revision);
    gestures.cancel();
    expect(editor.docRevision).toBe(revision);
    expect(editor.canUndo).toBe(false);
  });
  it('cancels a stroke before another marker command without resurrecting the draft on undo', () => {
    const { editor, gestures } = fixture([0]);
    const actions = createEditorActions(editor);
    gestures.begin(point(48)); gestures.move(point(120));
    actions.setMarker(200);
    gestures.end(point(120));
    expect(editor.ticks).toEqual([0, 200]);
    actions.undo();
    expect(editor.ticks).toEqual([0]);
    expect(editor.canUndo).toBe(false);
  });
  it('keeps a click pending and commits one snapped marker with undo/redo', () => {
    const { editor, gestures } = fixture();
    gestures.begin(point(49)); expect(editor.ticks).toEqual([]);
    gestures.move(point(50)); expect(editor.ticks).toEqual([]);
    gestures.end(point(50)); expect(editor.ticks).toEqual([48]);
    editor.undo(); expect(editor.ticks).toEqual([]);
    editor.redo(); expect(editor.ticks).toEqual([48]);
  });
  it('fills skipped grid cells during a fast paint sweep as one undo entry', () => {
    const { editor, gestures } = fixture();
    gestures.begin(point(24)); gestures.move(point(120)); gestures.move(point(168)); gestures.end(point(168));
    expect(editor.ticks).toEqual([24, 48, 72, 96, 120, 144, 168]);
    editor.undo(); expect(editor.ticks).toEqual([]); expect(editor.canUndo).toBe(false);
  });
  it('cancels a stroke without consuming undo history', () => {
    const { editor, gestures } = fixture([0]);
    gestures.begin(point(48)); gestures.move(point(120)); expect(editor.previewTicks).toEqual([0, 48, 72, 96, 120]);
    expect(gestures.cancel()).toBe(true); expect(editor.ticks).toEqual([0]); expect(editor.canUndo).toBe(false);
    expect(gestures.cancel()).toBe(false);
  });
  it('erases every crossed marker even between sparse pointer events', () => {
    const { editor, gestures } = fixture([24, 48, 72, 96]);
    gestures.begin(point(24, { button: 2 })); gestures.move(point(96, { button: 2 })); gestures.end(point(96, { button: 2 }));
    expect(editor.ticks).toEqual([]);
    editor.undo(); expect(editor.ticks).toEqual([24, 48, 72, 96]); expect(editor.canUndo).toBe(false);
  });
  it('restores erased bitmap on cancellation', () => {
    const { editor, gestures } = fixture([24, 48]);
    editor.setSelectedTicks([24, 48]);
    gestures.begin(point(24, { button: 2 })); expect(editor.previewTicks).toEqual([48]); expect(editor.selectedTicks).toEqual([24, 48]);
    gestures.cancel(); expect(editor.ticks).toEqual([24, 48]); expect(editor.selectedTicks).toEqual([24, 48]); expect(editor.canUndo).toBe(false);
  });
  it('uses Alt integer placement and throttles freehand movement by CSS pixels', () => {
    const { editor, gestures } = fixture(); editor.pxPerTick = .25;
    gestures.begin(point(10, { altKey: true })); gestures.move(point(14, { altKey: true }));
    gestures.move(point(15, { altKey: true })); gestures.end(point(15, { altKey: true }));
    expect(editor.ticks).toEqual([40, 56]);
  });
  it('adds and toggles box selections without painting, and restores cancelled selection', () => {
    const { editor, gestures } = fixture([24, 48, 72]); editor.setSelectedTicks([24]);
    gestures.begin(point(40, { shiftKey: true })); gestures.move(point(80, { shiftKey: true })); gestures.end(point(80, { shiftKey: true }));
    expect(editor.selectedTicks).toEqual([24, 48, 72]);
    gestures.begin(point(40, { ctrlKey: true })); gestures.move(point(60, { ctrlKey: true })); gestures.end(point(60, { ctrlKey: true }));
    expect(editor.selectedTicks).toEqual([24, 72]);
    gestures.begin(point(0, { shiftKey: true })); gestures.cancel(); expect(editor.selectedTicks).toEqual([24, 72]);
    expect(editor.ticks).toEqual([24, 48, 72]); expect(editor.canUndo).toBe(false);
  });
  it('moves a group through a ghost, clamps its shared delta, and preserves spacing', () => {
    const { editor, gestures } = fixture([24, 48]); editor.setSelectedTicks([24, 48]);
    gestures.begin(point(24)); gestures.move(point(-100));
    expect(gestures.ghost.value).toEqual({ ticks: [24, 48], delta: -24 }); expect(editor.ticks).toEqual([24, 48]);
    gestures.end(point(-100)); expect(editor.ticks).toEqual([0, 24]); expect(editor.selectedTicks).toEqual([0, 24]);
    editor.undo(); expect(editor.ticks).toEqual([24, 48]);
  });
  it('rejects cuts beyond source end and clamps group motion to the same end', () => {
    const { editor, gestures } = fixture([24, 48]);
    editor.setSource({ name: 'test', reference: null, sampleRate: 48000, channels: 1, length: 36000, data: [new Int16Array(36000)], floatData: [new Float32Array(36000)] });
    gestures.begin(point(96)); gestures.end(point(96)); expect(editor.ticks).toEqual([24, 48]);
    editor.setSelectedTicks([24, 48]); gestures.begin(point(24)); gestures.move(point(120)); gestures.end(point(120)); expect(editor.ticks).toEqual([48, 72]);
  });
  it('allows a dragged cut at the same fractional-time EOF accepted by marker placement', () => {
    const { editor, gestures } = fixture([24]);
    editor.setDocumentOptions({ bpm: 123 });
    editor.setSource({ name: 'test', reference: null, sampleRate: 48000, channels: 1, length: 48780, data: [new Int16Array(48780)], floatData: [new Float32Array(48780)] });
    expect(editor.legalTick(100)).toBe(true); expect(editor.legalTick(101)).toBe(false);
    gestures.begin(point(24, { altKey: true })); gestures.move(point(200, { altKey: true })); gestures.end(point(200, { altKey: true }));
    expect(editor.ticks).toEqual([100]);
    editor.undo(); expect(editor.ticks).toEqual([24]);
  });
  it('unregisters old gesture owners without cancelling a newly registered draft', () => {
    const { editor, gestures } = fixture([0]);
    gestures.begin(point(48)); gestures.move(point(120));
    const replacement = createTimelineGestures(editor);
    expect(editor.previewTicks).toBeNull();
    replacement.begin(point(48)); replacement.move(point(96));
    gestures.dispose(); expect(editor.previewTicks).toEqual([0, 48, 72, 96]);
    replacement.dispose(); expect(editor.previewTicks).toBeNull(); expect(editor.ticks).toEqual([0]);
  });
  it('pans, cancels pan, scrolls, and keeps a zoom anchor at the same pixel', () => {
    const { editor, gestures } = fixture(); editor.setScrollTick(100);
    gestures.begin(point(100, { button: 1 })); gestures.move(point(150)); expect(editor.scrollTick).toBe(50);
    gestures.cancel(); expect(editor.scrollTick).toBe(100);
    gestures.wheel(200, 20, 30, false); expect(editor.scrollTick).toBe(150);
    const anchor = 350; gestures.wheel(200, 0, -1, true);
    expect((anchor - editor.scrollTick) * editor.pxPerTick).toBeCloseTo(200);
  });
  it('does not restore an old bitmap into a replaced document', () => {
    const { editor, gestures } = fixture(); gestures.begin(point(24)); gestures.move(point(96));
    const next = createEmptyProject(); next.slicing.markers = [300]; editor.replaceDocument(next); gestures.cancel(); expect(editor.ticks).toEqual([300]);
  });
});
