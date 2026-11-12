import { createPinia, disposePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { useBmhelperStore } from '../../src/bmhelper/store';
import { useEditorStore } from '../../src/slicing/editor-store';
import { createEmptyProject } from '../../src/project/codec';
import { defaultDivisionSetting } from '../../src/core/bmhelper';
import { readSmfSequence, writeSmfSequence } from '../../src/core/smf';
import { nextTick } from 'vue';
import { readBmh, writeBmh } from '../../src/core/bmh';
import { readFileSync } from 'node:fs';
import { decodeProject, encodeProject } from '../../src/project/codec';
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
  it('writes and reopens large note chunks without spreading bytes onto the call stack', () => {
    const notes = Array.from({ length: 100_000 }, (_, i) => ({
      position: i * 120,
      nn: 60,
      vel: 100,
      gate: 60,
    }));
    const bytes = writeBmh({
      source: { quantize: 480, notes, pitches: [], controls: [] },
      divisions: [],
    });
    expect(bytes.byteLength).toBeGreaterThan(1_600_000);
    const restored = readBmh(bytes);
    expect(restored.source.notes.length).toBe(notes.length);
    expect(restored.source.notes[99_999]).toEqual(notes[99_999]);
    expect(writeBmh(restored)).toEqual(bytes);
  });
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
  it('saves Unicode names and FF numbering in UTF-8 DX JSON independently of BMH export', async () => {
    const pinia = createPinia();
    try {
      const store = useBmhelperStore(pinia);
      const editor = useEditorStore(pinia);
      store.bindEditor(editor);
      const original = new Uint8Array(readFileSync('tests/fixtures/bmh/original.bmh'));
      store.openProject(original, 'original.bmh');
      const name = '简体中文・한국어・🎵';
      store.addDivision({ ...defaultDivisionSetting(name, 480), zzDefinition: false });
      const bytes = encodeProject(editor.document);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toContain(name);
      const saved = decodeProject(bytes);
      if (saved.kind !== 'supported') throw new Error('Expected a supported project');
      editor.replaceDocument(createEmptyProject('other'));
      editor.replaceDocument(saved.project);
      store.selectDivision(1);
      expect(store.selectedDivision?.name).toBe(name);
      expect(store.selectedDivision?.zzDefinition).toBe(false);
      const before = editor.document;
      let writes = 0;
      await expect(
        store.saveBmhProject((exported, changes) => {
          writes++;
          expect(changes[0].original).toBe(name);
          expect(readBmh(exported).divisions[1].name).toBe(changes[0].exported);
          return Promise.resolve(true);
        }),
      ).resolves.toBe(true);
      expect(writes).toBe(1);
      expect(editor.document).toBe(before);
      store.renameDivision('日本語');
      expect(readBmh(store.saveProjectBytes()).divisions[1].name).toBe('日本語');
      editor.undo();
      expect(store.selectedDivision?.name).toBe(name);
    } finally {
      disposePinia(pinia);
    }
  });
  it('retains original BMH bytes through project saving, reopening and editing', () => {
    const original = new Uint8Array(readFileSync('tests/fixtures/bmh/original-events.bmh'));
    const pinia = createPinia();
    try {
      const store = useBmhelperStore(pinia);
      const editor = useEditorStore(pinia);
      store.bindEditor(editor);
      store.openProject(original, 'original.bmh');
      const saved = decodeProject(encodeProject(editor.document));
      if (saved.kind !== 'supported') throw new Error('Expected a supported project');
      editor.replaceDocument(createEmptyProject('other'));
      editor.replaceDocument(saved.project);
      expect(store.saveProjectBytes()).toEqual(original);
      expect(store.project?.divisions.map((division) => division.name)).toEqual([
        'コード分割',
        'copy',
      ]);
      store.transpose(1);
      expect(readBmh(store.saveProjectBytes()).divisions[0].definitions[0].zz).toBe(2);
      editor.undo();
      expect(store.saveProjectBytes()).toEqual(original);
    } finally {
      disposePinia(pinia);
    }
  });
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
    expect(store.selectedDivision).toBeNull();
    const importedBytes = store.saveProjectBytes();
    editor.redo();
    expect(store.selectedDivision?.name).toBe('first');
    expect(store.saveProjectBytes()).not.toEqual(importedBytes);
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
    editor.undo();
    expect(store.dirty).toBe(false);
    editor.redo();
    expect(store.dirty).toBe(true);
    disposePinia(pinia);
  });
  it('starts a new edit from the undone document without restoring removed divisions', () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    store.addDivision(defaultDivisionSetting('removed', 480));
    editor.undo();
    store.addDivision(defaultDivisionSetting('replacement', 480));
    expect(store.project?.divisions.map((division) => division.name)).toEqual(['replacement']);
    expect(editor.canRedo).toBe(false);
    disposePinia(pinia);
  });
  it('reloads changed payloads when the replacement document keeps the same project ID', () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    store.addDivision(defaultDivisionSetting('first', 480));
    const original = structuredClone(editor.document);
    const bytes = store.saveProjectBytes();
    store.addDivision(defaultDivisionSetting('second', 480));
    editor.replaceDocument(original);
    expect(store.project?.divisions.map((division) => division.name)).toEqual(['first']);
    expect(store.saveProjectBytes()).toEqual(bytes);
    expect(store.selectedIndex).toBe(0);
    expect(store.name).toBe('');
    expect(store.dirty).toBe(false);
    editor.replaceDocument({ ...original, bmhelper: null });
    expect(store.project).toBeNull();
    expect(store.cutTicks()).toEqual([]);
    disposePinia(pinia);
  });
  it('resets session-only numbering when the same BMH bytes are opened again', () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    store.addDivision({ ...defaultDivisionSetting('ff', 480), zzDefinition: false });
    const bytes = store.saveProjectBytes();
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    store.openProject(bytes, 'reopened.bmh');
    expect(store.selectedDivision?.zzDefinition).toBe(true);
    expect(store.saveProjectBytes()).toEqual(bytes);
    expect(store.dirty).toBe(false);
    disposePinia(pinia);
  });
  it('starts a fresh session on same-ID replacement and ignores the earlier save completion', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    let release = () => {};
    const saving = store.saveBmhProject(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    store.addDivision({ ...defaultDivisionSetting('ff', 480), zzDefinition: false });
    editor.replaceDocument(structuredClone(editor.document));
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    expect(store.name).toBe('');
    expect(store.dirty).toBe(false);
    release();
    await saving;
    expect(store.dirty).toBe(false);
    disposePinia(pinia);
  });
  it('keeps local selection, filename and FF numbering through unrelated edits and history', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    store.addDivision(defaultDivisionSetting('first', 480));
    store.addDivision({ ...defaultDivisionSetting('ff', 480), zzDefinition: false });
    await store.saveBmhProject(() => Promise.resolve(true));
    editor.setOutputOptions({ baseName: 'unrelated' });
    editor.setDocumentOptions({ bpm: 130 });
    editor.setDocumentOptions({ bpm: 140 });
    expect(store.name).toBe('source');
    expect(store.selectedIndex).toBe(1);
    expect(store.dirty).toBe(false);
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    store.setStart(35);
    expect(store.selectedDivision?.definitions.map((definition) => definition.zz)).toEqual([
      35, 36,
    ]);
    store.transpose(1);
    expect(store.selectedDivision?.definitions.map((definition) => definition.zz)).toEqual([
      36, 37,
    ]);
    editor.undo();
    editor.undo();
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    editor.undo();
    expect(editor.doc.bpm).toBe(130);
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    editor.undo();
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    editor.redo();
    editor.redo();
    editor.redo();
    expect(store.selectedDivision?.zzDefinition).toBe(false);
    expect(store.selectedDivision?.definitions[0]?.zz).toBe(35);
    store.transpose(1);
    expect(store.selectedDivision?.definitions[0]?.zz).toBe(36);
    disposePinia(pinia);
  });
  it('leaves content and local state unchanged when a read-only document rejects an edit', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    store.addDivision(defaultDivisionSetting('first', 480));
    await store.saveBmhProject(() => Promise.resolve(true));
    const bytes = store.saveProjectBytes();
    editor.setLimited(true);
    for (const edit of [
      () => store.transpose(1),
      () => store.setStart(35),
      () => store.deleteDivision(),
      () => store.addDivision(defaultDivisionSetting('rejected', 480)),
      () => store.openProject(bytes, 'rejected.bmh'),
      () => store.importMidi(midi, 'rejected.mid', trackOf(store), new Set([0])),
    ]) {
      expect(edit).toThrow('read-only');
      expect(store.saveProjectBytes()).toEqual(bytes);
      expect(store.name).toBe('source');
      expect(store.selectedIndex).toBe(0);
      expect(store.dirty).toBe(false);
    }
    disposePinia(pinia);
  });
  it('does not apply an old save baseline after switching away and back to a project', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    const editor = useEditorStore(pinia);
    store.bindEditor(editor);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    const original = editor.document;
    let release = () => {};
    const saving = store.saveBmhProject(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    editor.replaceDocument(createEmptyProject('other'));
    editor.replaceDocument(original);
    store.addDivision(defaultDivisionSetting('new', 480));
    await store.saveBmhProject(() => Promise.resolve(true));
    release();
    await saving;
    expect(store.dirty).toBe(false);
    disposePinia(pinia);
  });
  it('keeps the current saved state when a save is cancelled', async () => {
    const pinia = createPinia();
    const store = useBmhelperStore(pinia);
    store.importMidi(midi, 'source.mid', trackOf(store), new Set([0]));
    expect(await store.saveBmhProject(() => Promise.resolve(false))).toBe(false);
    expect(store.dirty).toBe(true);
    await store.saveBmhProject(() => Promise.resolve(true));
    expect(await store.saveBmhProject(() => Promise.resolve(false))).toBe(false);
    expect(store.dirty).toBe(false);
    disposePinia(pinia);
  });
});
