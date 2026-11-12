import { createPinia, disposePinia, type Pinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBmseClipboard, parseBmseClipboard } from '../../src/core/bmse';
import { MAX_TICKS, MEASURE_TICKS } from '../../src/core/timebase';
import { createEmptyProject } from '../../src/project/codec';
import { createEditorActions } from '../../src/slicing/editor-actions';
import { useEditorStore } from '../../src/slicing/editor-store';

const instances: Pinia[] = [];
function fixture(ticks: number[] = []) {
  const pinia = createPinia();
  instances.push(pinia);
  const editor = useEditorStore(pinia);
  const project = createEmptyProject('marker-actions-test');
  project.slicing.markers = ticks;
  editor.replaceDocument(project);
  return { editor, actions: createEditorActions(editor) };
}
afterEach(() => {
  for (const pinia of instances.splice(0)) disposePinia(pinia);
});

describe('marker editing actions', () => {
  it('places a marker once and keeps repeated placement out of undo history', () => {
    const { editor, actions } = fixture();
    expect(actions.setMarker(384)).toBe(true);
    expect(actions.setMarker(384)).toBe(false);
    expect(editor.ticks).toEqual([384]);
    actions.undo();
    expect(editor.ticks).toEqual([]);
    expect(editor.canUndo).toBe(false);
  });

  it('toggles the marker under the cursor', () => {
    const { editor, actions } = fixture();
    editor.setCursorTick(100);
    actions.toggleMarker();
    expect(editor.ticks).toEqual([100]);
    actions.toggleMarker();
    expect(editor.ticks).toEqual([]);
  });

  it('moves only the selected markers', () => {
    const { editor, actions } = fixture([100, 200, 300, 400]);
    editor.setSelectedTicks([200, 300]);
    expect(actions.moveSelection(50)).toBe(50);
    expect(editor.ticks).toEqual([100, 250, 350, 400]);
    expect(editor.selectedTicks).toEqual([250, 350]);
  });

  it.each([
    { ticks: [10, 20, 30], delta: 1000, applied: 1000, expected: [1010, 1020, 1030] },
    {
      ticks: [10, 20, 30],
      delta: 999999,
      applied: MAX_TICKS - 1 - 30,
      expected: [MAX_TICKS - 21, MAX_TICKS - 11, MAX_TICKS - 1],
    },
    { ticks: [100, 150], delta: -1000, applied: -100, expected: [0, 50] },
  ])(
    'preserves group spacing when moving by $delta ticks',
    ({ ticks, delta, applied, expected }) => {
      const { editor, actions } = fixture(ticks);
      editor.setSelectedTicks(ticks);
      expect(actions.moveSelection(delta)).toBe(applied);
      expect(editor.ticks).toEqual(expected);
      actions.undo();
      expect(editor.ticks).toEqual(ticks);
      expect(editor.canUndo).toBe(false);
    },
  );

  it('does not add history for an empty selection or a zero move', () => {
    const { editor, actions } = fixture([5]);
    expect(actions.moveSelection(10)).toBe(0);
    editor.setSelectedTicks([5]);
    expect(actions.moveSelection(0)).toBe(0);
    expect(editor.ticks).toEqual([5]);
    expect(editor.canUndo).toBe(false);
  });

  it('quantizes only selected markers in one undo step', () => {
    const { editor, actions } = fixture([10, 12, 26, 100]);
    editor.grid = 24; // 24 cells per measure gives an 8-tick grid.
    editor.setSelectedTicks([10, 12, 26]);
    expect(actions.quantizeSelection()).toBe(true);
    expect(editor.ticks).toEqual([8, 16, 24, 100]);
    expect(editor.selectedTicks).toEqual([8, 16, 24]);
    actions.undo();
    expect(editor.ticks).toEqual([10, 12, 26, 100]);
    expect(editor.canUndo).toBe(false);
  });

  it('merges quantized markers with an occupied target tick', () => {
    const { editor, actions } = fixture([6, 8, 9, 200]);
    editor.grid = 24;
    editor.setSelectedTicks([6, 9]);
    expect(actions.quantizeSelection()).toBe(true);
    expect(editor.ticks).toEqual([8, 200]);
    expect(editor.selectedTicks).toEqual([8]);
  });

  it.each([{ selected: [] }, { selected: [0, 8, 16] }])(
    'keeps no-op quantization out of history for selection $selected',
    ({ selected }) => {
      const { editor, actions } = fixture([0, 8, 16]);
      editor.grid = 24;
      editor.setSelectedTicks(selected);
      expect(actions.quantizeSelection()).toBe(false);
      expect(editor.ticks).toEqual([0, 8, 16]);
      expect(editor.canUndo).toBe(false);
    },
  );

  it('does not recreate deleted markers from a stale selection', () => {
    const { editor, actions } = fixture([100]);
    editor.grid = 24;
    // A stale selection must remain harmless even before the next store publication.
    editor.selectedTicks = [10];
    expect(actions.quantizeSelection()).toBe(false);
    expect(editor.ticks).toEqual([100]);
    expect(editor.canUndo).toBe(false);
  });

  it('quantizes surviving markers when part of the selection is stale', () => {
    const { editor, actions } = fixture([10]);
    editor.grid = 24;
    editor.selectedTicks = [10, 26];
    expect(actions.quantizeSelection()).toBe(true);
    expect(editor.ticks).toEqual([8]);
    expect(editor.selectedTicks).toEqual([8]);
  });

  it('undoes and redoes marker commands in order', () => {
    const { editor, actions } = fixture();
    actions.setMarker(10);
    actions.setMarker(20);
    expect(editor.ticks).toEqual([10, 20]);
    actions.undo();
    expect(editor.ticks).toEqual([10]);
    actions.undo();
    expect(editor.ticks).toEqual([]);
    expect(actions.undo()).toBe(false);
    actions.redo();
    expect(editor.ticks).toEqual([10]);
    actions.redo();
    expect(editor.ticks).toEqual([10, 20]);
    expect(actions.redo()).toBe(false);
  });

  it('discards redo after a new marker command', () => {
    const { editor, actions } = fixture();
    actions.setMarker(1);
    actions.undo();
    actions.setMarker(2);
    expect(editor.canRedo).toBe(false);
    expect(editor.ticks).toEqual([2]);
  });

  it('adds a batch as one undo step and ignores already present markers', () => {
    const { editor, actions } = fixture([10]);
    expect(editor.addTicks([10, 20, 30])).toBe(2);
    expect(editor.addTicks([20, 30])).toBe(0);
    actions.undo();
    expect(editor.ticks).toEqual([10]);
    expect(editor.canUndo).toBe(false);
    actions.redo();
    expect(editor.ticks).toEqual([10, 20, 30]);
  });

  it('removes selected markers as one undo step', () => {
    const { editor, actions } = fixture([5, 15, 25, 40]);
    editor.setSelectedTicks([5, 15, 25]);
    actions.removeSelected();
    expect(editor.ticks).toEqual([40]);
    actions.undo();
    expect(editor.ticks).toEqual([5, 15, 25, 40]);
    expect(editor.canUndo).toBe(false);
  });

  it('drops markers shifted outside the timeline when no audio is bound', () => {
    const { editor, actions } = fixture([0, 100, MAX_TICKS - 1]);
    actions.shiftAll(1);
    expect(editor.ticks).toEqual([1, 101]);
    actions.shiftAll(-2);
    expect(editor.ticks).toEqual([99]);
  });
});

describe('selection clipboard actions', () => {
  it('copies without editing and pastes relative offsets at the cursor', () => {
    const { editor, actions } = fixture([100, 124, 220]);
    editor.setSelectedTicks([220, 100, 124]);
    actions.copySelection();
    expect(editor.ticks).toEqual([100, 124, 220]);
    expect(editor.canUndo).toBe(false);
    editor.setCursorTick(1000);
    expect(actions.pasteSelection()).toBe(true);
    expect(editor.ticks).toEqual([100, 124, 220, 1000, 1024, 1120]);
    expect(editor.selectedTicks).toEqual([1000, 1024, 1120]);
  });

  it('cuts selected markers and retains them for a later paste', () => {
    const { editor, actions } = fixture([10, 20, 300]);
    editor.setSelectedTicks([10, 20]);
    actions.cutSelection();
    expect(editor.ticks).toEqual([300]);
    actions.undo();
    expect(editor.ticks).toEqual([10, 20, 300]);
    expect(editor.canUndo).toBe(false);
    editor.setCursorTick(100);
    actions.pasteSelection();
    expect(editor.selectedTicks).toEqual([100, 110]);
  });

  it('rejects the entire paste group when one target collides', () => {
    const { editor, actions } = fixture([100, 124, 1024]);
    editor.setSelectedTicks([100, 124]);
    actions.copySelection();
    editor.setCursorTick(1000);
    expect(actions.pasteSelection()).toBe(false);
    expect(editor.ticks).toEqual([100, 124, 1024]);
    expect(editor.canUndo).toBe(false);
    expect(editor.status.segments[0]?.key).toBe('pasteRejected');
  });

  it('allows a paste at its own origin without adding undo history', () => {
    const { editor, actions } = fixture([100, 124]);
    editor.setSelectedTicks([100, 124]);
    actions.copySelection();
    editor.setCursorTick(100);
    expect(actions.pasteSelection()).toBe(true);
    expect(editor.ticks).toEqual([100, 124]);
    expect(editor.canUndo).toBe(false);
  });

  it('rejects the whole group when any target leaves the timeline', () => {
    const { editor, actions } = fixture([100, 124]);
    editor.setSelectedTicks([100, 124]);
    actions.copySelection();
    editor.setCursorTick(MAX_TICKS - 10);
    expect(actions.pasteSelection()).toBe(false);
    expect(editor.ticks).toEqual([100, 124]);
    expect(editor.canUndo).toBe(false);
  });

  it('rejects an empty clipboard without editing', () => {
    const { editor, actions } = fixture([100]);
    expect(actions.pasteSelection()).toBe(false);
    expect(editor.ticks).toEqual([100]);
    expect(editor.canUndo).toBe(false);
    expect(editor.status.segments[0]?.key).toBe('pasteClipboardEmpty');
  });

  it('keeps selection clipboard offsets independent of BMSE data', () => {
    const { editor, actions } = fixture([5, 40]);
    editor.setSelectedTicks([5, 40]);
    actions.copySelection();
    const text = buildBmseClipboard(editor.ticks, { startNumber: 1, useFfNumbering: false });
    editor.setTicks(parseBmseClipboard(text).ticks.map((tick) => tick + 200));
    editor.setCursorTick(100);
    actions.pasteSelection();
    expect(editor.selectedTicks).toEqual([100, 135]);
    expect(editor.ticks).toEqual([100, 135, 205, 240]);
  });
});

describe('measure clipboard actions', () => {
  it('copies exactly one measure and replaces the destination measure', () => {
    const { editor, actions } = fixture([0, 100, 191, 192, 300, 400]);
    editor.setCursorTick(100);
    actions.measureCopy();
    expect(editor.canUndo).toBe(false);
    editor.setCursorTick(MEASURE_TICKS);
    expect(actions.measurePaste()).toBe(true);
    expect(editor.ticks).toEqual([0, 100, 191, 192, 292, 383, 400]);
    actions.undo();
    expect(editor.ticks).toEqual([0, 100, 191, 192, 300, 400]);
    expect(editor.canUndo).toBe(false);
  });

  it('cuts only the source measure and retains it for paste', () => {
    const { editor, actions } = fixture([10, 200]);
    actions.measureCut();
    expect(editor.ticks).toEqual([200]);
    editor.setCursorTick(MEASURE_TICKS * 2);
    actions.measurePaste();
    expect(editor.ticks).toEqual([200, 394]);
  });

  it('keeps the measure clipboard independent of BMSE imports', () => {
    const { editor, actions } = fixture([10]);
    actions.measureCopy();
    const text = buildBmseClipboard(editor.ticks, { startNumber: 1, useFfNumbering: false });
    editor.setTicks(parseBmseClipboard(text).ticks.map((tick) => tick + 50));
    editor.setCursorTick(MEASURE_TICKS);
    actions.measurePaste();
    expect(editor.ticks).toEqual([60, 202]);
    expect(parseBmseClipboard(text).ticks).toEqual([10]);
  });
});
