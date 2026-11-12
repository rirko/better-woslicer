import { createPinia, disposePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { useBmhelperStore } from '../../src/bmhelper/store';
import { useEditorStore } from '../../src/slicing/editor-store';
import { createEmptyProject } from '../../src/project/codec';
import { defaultDivisionSetting } from '../../src/core/bmhelper';
import { readSmfSequence, writeSmfSequence } from '../../src/core/smf';
import { nextTick } from 'vue';
const midi = writeSmfSequence({
  quantize: 480,
  notes: [
    { position: 0, nn: 60, vel: 100, gate: 120 },
    { position: 480, nn: 64, vel: 90, gate: 240 },
  ],
  pitches: [],
  controls: [],
});

describe('BMHelper project state', () => {
  it('imports, creates, selects, renumbers and round-trips project and recording MIDI', () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const info = store.inspectMidi(midi);
    const track = info.tracks.find((value) => value.noteCount > 0);
    expect(track).toBeDefined();
    store.importMidi(midi, 'source.mid', track?.index ?? 0, new Set([0]));
    expect(store.name).toBe('source');
    store.addDivision(defaultDivisionSetting('first', 480));
    expect(store.cutTicks()).toEqual([0, 96]);
    store.transpose(1);
    expect(store.selectedDivision?.definitions[0]?.zz).toBe(2);
    store.setStart(35);
    expect(store.selectedDivision?.definitions[0]?.zz).toBe(35);
    const recording = store.exportMidiBytes();
    const recordingTrack = store.inspectMidi(recording).tracks.find((value) => value.noteCount > 0);
    expect(readSmfSequence(recording, recordingTrack?.index ?? 0, new Set([0])).notes).toEqual(
      store.selectedDivision?.recording,
    );
    const saved = store.saveProjectBytes();
    store.addDivision(defaultDivisionSetting('second', 480));
    expect(store.selectedIndex).toBe(1);
    store.selectDivision(0);
    store.deleteDivision();
    expect(store.selectedDivision?.name).toBe('second');
    store.openProject(saved, 'restored.bmh');
    expect(store.selectedDivision?.name).toBe('first');
    expect(store.selectedDivision?.definitions[0]?.zz).toBe(35);
    expect(store.dirty).toBe(false);
    disposePinia(pinia);
  });
  it('preserves the current project when MIDI or project input is invalid', () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const track = store.inspectMidi(midi).tracks.find((value) => value.noteCount > 0)?.index ?? 0;
    store.importMidi(midi, 'valid.mid', track, new Set([0]));
    const before = store.project;
    expect(() => store.openProject(new Uint8Array([0]), 'bad.bmh')).toThrow();
    expect(store.project).toBe(before);
    expect(() => store.importMidi(midi, 'empty.mid', 0, new Set())).toThrow('no-notes');
    expect(store.project).toBe(before);
    store.deleteDivision(-1);
    store.selectDivision(100);
    expect(store.selectedIndex).toBe(0);
    expect(() => store.setStart(Number.NaN)).toThrow('invalid-start');
    disposePinia(pinia);
  });
});

describe('BMHelper project integration', () => {
  const trackOf = (store: ReturnType<typeof useBmhelperStore>): number =>
    store.inspectMidi(midi).tracks.find((value) => value.noteCount > 0)?.index ?? 0;
  it('commits edits into the bound project document as undoable transactions and reloads on a switch', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    expect(editor.document.bmhelper).not.toBeNull();
    const afterImport = editor.document.bmhelper;
    expect(editor.isDirty).toBe(true);
    store.addDivision(defaultDivisionSetting('first', 480));
    expect(editor.document.bmhelper).not.toEqual(afterImport);
    expect(editor.canUndo).toBe(true);
    editor.undo();
    expect(editor.document.bmhelper).toEqual(afterImport);
    expect(store.selectedDivision?.name).toBe('first'); // the working copy keeps its state
    editor.replaceDocument(createEmptyProject('other'));
    await nextTick();
    expect(store.project).toBeNull();
    expect(store.dirty).toBe(false);
    disposePinia(pinia);
  });
  it('keeps newer edits dirty when a save completes after them', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    store.addDivision(defaultDivisionSetting('first', 480));
    let release: (() => void) | undefined;
    const saving = store.saveBmhProject(
      async () =>
        new Promise((resolve) => {
          release = () => resolve(true);
        }),
    );
    store.transpose(1); // a real edit lands while the save is still in flight
    if (!release) throw new Error('Expected a pending save');
    release();
    expect(await saving).toBe(true);
    expect(store.dirty).toBe(true);
    disposePinia(pinia);
  });
});
