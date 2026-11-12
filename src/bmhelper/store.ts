import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import {
  createDivision,
  nextZz,
  prevZz,
  setStartDefinition,
  type DivisionSetting,
} from '../core/bmhelper';
import { readBmh, writeBmh, type BmhProject, type BmhNameChange } from '../core/bmh';
import { inspectSmf, readSmfSequence, writeSmfSequence } from '../core/smf';
import type { EditorStore } from '../slicing/editor-store';
import {
  bmhelperDocumentSchema,
  bmhelperFromDocument,
  bmhelperToDocument,
  type BmhelperDocument,
} from '../project/bmhelper';

export const useBmhelperStore = defineStore('bmhelper', () => {
  const bound = shallowRef<EditorStore | null>(null);
  const standaloneDocument = shallowRef<BmhelperDocument | null>(null);
  const document = computed(() =>
    bound.value ? bound.value.document.bmhelper : standaloneDocument.value,
  );
  // The UTF-8 document owns names and numbering mode. BMH conversion happens only at file IO.
  const project = computed(() =>
    document.value ? bmhelperFromDocument(bmhelperDocumentSchema.parse(document.value)) : null,
  );
  const payload = computed(() => (document.value === null ? null : JSON.stringify(document.value)));
  const name = ref('');
  const selectedIndex = ref(0);
  const savedPayload = ref<string | null>(null);
  const dirty = computed(() => project.value !== null && payload.value !== savedPayload.value);
  let saveScope = 0;
  const selectedDivision = computed(() => project.value?.divisions[selectedIndex.value] ?? null);
  watch(
    () => bound.value?.documentGeneration,
    () => {
      saveScope++;
      name.value = '';
      selectedIndex.value = 0;
      savedPayload.value = payload.value;
    },
    { flush: 'sync' },
  );
  watch(
    project,
    (value) => {
      selectedIndex.value = Math.min(
        selectedIndex.value,
        Math.max(0, (value?.divisions.length ?? 0) - 1),
      );
    },
    { flush: 'sync' },
  );
  /** The document payload owns content; only names and selection stay local. */
  function bindEditor(target: EditorStore): void {
    if (!bound.value) bound.value = target;
  }
  function commitProject(next: BmhProject): void {
    const nextDocument = bmhelperToDocument(next);
    const editor = bound.value;
    if (editor) {
      editor.transact((draft) => {
        draft.bmhelper = nextDocument;
      });
    } else standaloneDocument.value = nextDocument;
  }
  function inspectMidi(bytes: Uint8Array) {
    const inspection = inspectSmf(bytes);
    if (inspection.tracks.every((track) => track.noteCount === 0)) throw new Error('no-notes');
    return inspection;
  }
  function importMidi(
    bytes: Uint8Array,
    filename: string,
    trackIndex: number,
    channels: ReadonlySet<number>,
  ): void {
    const source = readSmfSequence(bytes, trackIndex, channels);
    if (source.notes.length === 0) throw new Error('no-notes');
    commitProject({ source, divisions: [] });
    saveScope++;
    name.value = filename.replace(/\.(mid|midi|smf)$/i, '');
    selectedIndex.value = 0;
  }
  function addDivision(setting: DivisionSetting): void {
    if (!project.value) throw new Error('no-project');
    const next = structuredClone(project.value);
    next.divisions.push(createDivision(next.source, setting));
    commitProject(next);
    selectedIndex.value = next.divisions.length - 1;
  }
  function selectDivision(index: number): void {
    if (Number.isInteger(index) && project.value?.divisions[index]) selectedIndex.value = index;
  }
  function renameDivision(name: string): void {
    if (!project.value?.divisions[selectedIndex.value]) return;
    const next = structuredClone(project.value);
    next.divisions[selectedIndex.value].name = name;
    commitProject(next);
  }
  function deleteDivision(index = selectedIndex.value): void {
    if (!Number.isInteger(index) || !project.value?.divisions[index]) return;
    const next = structuredClone(project.value);
    next.divisions.splice(index, 1);
    commitProject(next);
  }
  function transpose(delta: 1 | -1): void {
    const next = project.value ? structuredClone(project.value) : null;
    const division = next?.divisions[selectedIndex.value];
    if (!next || !division) return;
    for (const definition of division.definitions)
      definition.zz =
        delta === 1
          ? nextZz(definition.zz, !division.zzDefinition)
          : prevZz(definition.zz, !division.zzDefinition);
    commitProject(next);
  }
  function setStart(start: number): void {
    if (!Number.isInteger(start) || start < 0 || start > 1295)
      throw new RangeError('invalid-start');
    const next = project.value ? structuredClone(project.value) : null;
    const division = next?.divisions[selectedIndex.value];
    if (!next || !division) return;
    setStartDefinition(division, start, !division.zzDefinition);
    commitProject(next);
  }
  function exportMidiBytes(): Uint8Array {
    const division = selectedDivision.value;
    if (!division) throw new Error('no-division');
    return writeSmfSequence({
      quantize: division.quantize,
      notes: division.recording,
      pitches: [],
      controls: [],
    });
  }
  function openProject(bytes: Uint8Array, filename: string): void {
    const next = readBmh(bytes);
    if (!next.source.notes.length) throw new Error('no-notes');
    commitProject(next);
    saveScope++;
    name.value = filename.replace(/\.bmh$/i, '');
    selectedIndex.value = 0;
    savedPayload.value = payload.value;
  }
  function saveProjectBytes(): Uint8Array {
    if (!project.value) throw new Error('no-project');
    return writeBmh(project.value);
  }
  /** A completed save updates its byte baseline, never a newer project's state. */
  async function saveBmhProject(
    save: (bytes: Uint8Array, nameChanges: BmhNameChange[]) => Promise<boolean>,
  ): Promise<boolean> {
    if (!project.value) throw new Error('no-project');
    const nameChanges: BmhNameChange[] = [];
    const bytes = writeBmh(project.value, (change) => nameChanges.push(change));
    const savedAt = saveScope;
    const savingPayload = payload.value;
    if (!(await save(bytes, nameChanges))) return false;
    // A lossy legacy export does not save the original Unicode names.
    if (savedAt === saveScope && nameChanges.length === 0) savedPayload.value = savingPayload;
    return true;
  }
  function cutTicks(): number[] {
    const division = selectedDivision.value;
    return division
      ? division.recording.map((note) => Math.trunc((note.position * 48) / division.quantize))
      : [];
  }
  function reset(): void {
    if (bound.value?.document.bmhelper)
      bound.value.transact((draft) => {
        draft.bmhelper = null;
      });
    standaloneDocument.value = null;
    saveScope++;
    name.value = '';
    selectedIndex.value = 0;
    savedPayload.value = null;
  }
  return {
    project,
    name,
    selectedIndex,
    selectedDivision,
    dirty,
    bindEditor,
    inspectMidi,
    importMidi,
    addDivision,
    selectDivision,
    renameDivision,
    deleteDivision,
    transpose,
    setStart,
    exportMidiBytes,
    openProject,
    saveProjectBytes,
    saveBmhProject,
    cutTicks,
    reset,
  };
});
