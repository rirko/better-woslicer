import { computed, ref, shallowRef, triggerRef, watch } from 'vue';
import { defineStore } from 'pinia';
import {
  createDivision,
  nextZz,
  prevZz,
  setStartDefinition,
  type DivisionSetting,
} from '../core/bmhelper';
import { readBmh, writeBmh, type BmhProject } from '../core/bmh';
import { inspectSmf, readSmfSequence, writeSmfSequence } from '../core/smf';
import type { EditorStore } from '../slicing/editor-store';
import type { ProjectDocument } from '../project/schema';

/** Matches the wosdx codec bound for the bmhelper payload. */
const BMH_PAYLOAD_MAX_BASE64 = 32 * 1024 * 1024;
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export const useBmhelperStore = defineStore('bmhelper', () => {
  const bound = shallowRef<EditorStore | null>(null);
  const standalonePayload = ref<string | null>(null);
  const payload = computed(() =>
    bound.value ? (bound.value.document.bmhelper?.bytesBase64 ?? null) : standalonePayload.value,
  );
  // BMH bytes omit session settings such as zzDefinition. Cache committed
  // snapshots without making them independently editable. Weak keys retain
  // those settings through undo/redo without retaining discarded history.
  const history = shallowRef(new WeakMap<ProjectDocument, BmhProject>());
  const committed = shallowRef<{ payload: string; project: BmhProject } | null>(null);
  const project = computed(() => {
    const bytesBase64 = payload.value;
    if (bytesBase64 === null) return null;
    const document = bound.value?.document;
    const snapshot = document ? history.value.get(document) : undefined;
    if (snapshot) return snapshot;
    if (committed.value?.payload === bytesBase64) return committed.value.project;
    try {
      const decoded = readBmh(base64ToBytes(bytesBase64));
      return decoded.source.notes.length ? decoded : null;
    } catch {
      return null;
    }
  });
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
      history.value = new WeakMap();
      committed.value = null;
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
  watch(
    () => bound.value?.document,
    (document) => {
      if (document && project.value) history.value.set(document, project.value);
    },
    { flush: 'sync' },
  );
  /** The document payload owns content; only names and selection stay local. */
  function bindEditor(target: EditorStore): void {
    if (!bound.value) bound.value = target;
  }
  function commitProject(next: BmhProject): void {
    const bytesBase64 = bytesToBase64(writeBmh(next));
    if (bytesBase64.length > BMH_PAYLOAD_MAX_BASE64) throw new Error('bmh-too-large');
    const editor = bound.value;
    if (editor) {
      editor.transact((draft) => {
        draft.bmhelper = { format: 'bmh', bytesBase64 };
      });
      history.value.set(editor.document, next);
      // Reopening identical BMH bytes can reset session settings without a
      // document revision. Publish the cache change explicitly in that case too.
      triggerRef(history);
    } else standalonePayload.value = bytesBase64;
    committed.value = { payload: bytesBase64, project: next };
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
  async function saveBmhProject(save: (bytes: Uint8Array) => Promise<boolean>): Promise<boolean> {
    const bytes = saveProjectBytes();
    const savedAt = saveScope;
    const savingPayload = payload.value;
    if (!(await save(bytes))) return false;
    if (savedAt === saveScope) savedPayload.value = savingPayload;
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
    standalonePayload.value = null;
    committed.value = null;
    history.value = new WeakMap();
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
