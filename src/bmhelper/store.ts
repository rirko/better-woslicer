import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { createDivision, nextZz, prevZz, setStartDefinition, type DivisionSetting } from '../core/bmhelper';
import { readBmh, writeBmh, type BmhProject } from '../core/bmh';
import { inspectSmf, readSmfSequence, writeSmfSequence } from '../core/smf';
import type { EditorStore } from '../slicing/editor-store';

/** Matches the wosdx codec bound for the bmhelper payload. */
const BMH_PAYLOAD_MAX_BASE64 = 32 * 1024 * 1024;
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export const useBmhelperStore = defineStore('bmhelper', () => {
  const project = ref<BmhProject | null>(null);
  const name = ref('');
  const selectedIndex = ref(0);
  const dirty = ref(false);
  let bound: EditorStore | null = null;
  let editVersion = 0;
  const selectedDivision = computed(() => project.value?.divisions[selectedIndex.value] ?? null);
  /** BMH edits participate in the project document; a document switch reloads the working copy. */
  function bindEditor(target: EditorStore): void {
    if (bound) return;
    bound = target;
    watch(() => bound?.document.projectId, () => {
      const payload = bound?.document.bmhelper ?? null;
      if (!payload) { reset(); return; }
      try {
        const next = readBmh(base64ToBytes(payload.bytesBase64));
        if (!next.source.notes.length) throw new Error('no-notes');
        project.value = next; name.value = ''; selectedIndex.value = 0; dirty.value = false;
      } catch { reset(); }
    }, { immediate: true });
  }
  function commitPayload(): void {
    if (!bound || !project.value) return;
    const bytesBase64 = bytesToBase64(writeBmh(project.value));
    if (bytesBase64.length > BMH_PAYLOAD_MAX_BASE64) throw new Error('bmh-too-large');
    editVersion++;
    bound.transact(draft => { draft.bmhelper = { format: 'bmh', bytesBase64 }; });
  }
  function inspectMidi(bytes: Uint8Array) {
    const inspection = inspectSmf(bytes);
    if (inspection.tracks.every(track => track.noteCount === 0)) throw new Error('no-notes');
    return inspection;
  }
  function importMidi(bytes: Uint8Array, filename: string, trackIndex: number, channels: ReadonlySet<number>): void {
    const source = readSmfSequence(bytes, trackIndex, channels);
    if (source.notes.length === 0) throw new Error('no-notes');
    project.value = { source, divisions: [] };
    name.value = filename.replace(/\.(mid|midi|smf)$/i, '');
    selectedIndex.value = 0;
    dirty.value = true;
    commitPayload();
  }
  function addDivision(setting: DivisionSetting): void {
    if (!project.value) throw new Error('no-project');
    const division = createDivision(project.value.source, setting);
    project.value.divisions.push(division);
    selectedIndex.value = project.value.divisions.length - 1;
    dirty.value = true;
    commitPayload();
  }
  function selectDivision(index: number): void {
    if (Number.isInteger(index) && project.value?.divisions[index]) selectedIndex.value = index;
  }
  function deleteDivision(index = selectedIndex.value): void {
    if (!Number.isInteger(index) || !project.value?.divisions[index]) return;
    project.value.divisions.splice(index, 1);
    selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, project.value.divisions.length - 1));
    dirty.value = true;
    commitPayload();
  }
  function transpose(delta: 1 | -1): void {
    const division = selectedDivision.value;
    if (!division) return;
    for (const definition of division.definitions) definition.zz = delta === 1 ? nextZz(definition.zz, !division.zzDefinition) : prevZz(definition.zz, !division.zzDefinition);
    dirty.value = true;
    commitPayload();
  }
  function setStart(start: number): void {
    if (!Number.isInteger(start) || start < 0 || start > 1295) throw new RangeError('invalid-start');
    if (!selectedDivision.value) return;
    setStartDefinition(selectedDivision.value, start, !selectedDivision.value.zzDefinition);
    dirty.value = true;
    commitPayload();
  }
  function exportMidiBytes(): Uint8Array {
    const division = selectedDivision.value;
    if (!division) throw new Error('no-division');
    return writeSmfSequence({ quantize: division.quantize, notes: division.recording, pitches: [], controls: [] });
  }
  function openProject(bytes: Uint8Array, filename: string): void {
    const next = readBmh(bytes);
    if (!next.source.notes.length) throw new Error('no-notes');
    project.value = next;
    name.value = filename.replace(/\.bmh$/i, '');
    selectedIndex.value = 0;
    commitPayload();
    // The working copy now matches the loaded file; the document payload is updated.
    dirty.value = false;
  }
  function saveProjectBytes(): Uint8Array {
    if (!project.value) throw new Error('no-project');
    return writeBmh(project.value);
  }
  /** Writing the .bmh file may race a new edit: only a save with no newer edit clears dirty. */
  async function saveBmhProject(save: (bytes: Uint8Array) => Promise<boolean>): Promise<boolean> {
    const bytes = saveProjectBytes();
    const savedAt = editVersion;
    if (!await save(bytes)) return false;
    if (savedAt === editVersion) dirty.value = false;
    return true;
  }
  function cutTicks(): number[] {
    const division = selectedDivision.value;
    return division ? division.recording.map(note => Math.trunc(note.position * 48 / division.quantize)) : [];
  }
  function reset(): void { project.value = null; name.value = ''; selectedIndex.value = 0; dirty.value = false; }
  return { project, name, selectedIndex, selectedDivision, dirty, bindEditor, inspectMidi, importMidi, addDivision, selectDivision, deleteDivision, transpose, setStart, exportMidiBytes, openProject, saveProjectBytes, saveBmhProject, cutTicks, reset };
});
