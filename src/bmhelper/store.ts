import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { createDivision, nextZz, prevZz, setStartDefinition, type DivisionSetting } from '../core/bmhelper';
import { readBmh, writeBmh, type BmhProject } from '../core/bmh';
import { inspectSmf, readSmfSequence, writeSmfSequence } from '../core/smf';

export const useBmhelperStore = defineStore('bmhelper', () => {
  const project = ref<BmhProject | null>(null);
  const name = ref('');
  const selectedIndex = ref(0);
  const dirty = ref(false);
  const selectedDivision = computed(() => project.value?.divisions[selectedIndex.value] ?? null);
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
  }
  function addDivision(setting: DivisionSetting): void {
    if (!project.value) throw new Error('no-project');
    const division = createDivision(project.value.source, setting);
    project.value.divisions.push(division);
    selectedIndex.value = project.value.divisions.length - 1;
    dirty.value = true;
  }
  function selectDivision(index: number): void {
    if (Number.isInteger(index) && project.value?.divisions[index]) selectedIndex.value = index;
  }
  function deleteDivision(index = selectedIndex.value): void {
    if (!Number.isInteger(index) || !project.value?.divisions[index]) return;
    project.value.divisions.splice(index, 1);
    selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, project.value.divisions.length - 1));
    dirty.value = true;
  }
  function transpose(delta: 1 | -1): void {
    const division = selectedDivision.value;
    if (!division) return;
    for (const definition of division.definitions) definition.zz = delta === 1 ? nextZz(definition.zz, !division.zzDefinition) : prevZz(definition.zz, !division.zzDefinition);
    dirty.value = true;
  }
  function setStart(start: number): void {
    if (!Number.isInteger(start) || start < 0 || start > 1295) throw new RangeError('invalid-start');
    if (!selectedDivision.value) return;
    setStartDefinition(selectedDivision.value, start, !selectedDivision.value.zzDefinition);
    dirty.value = true;
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
    dirty.value = false;
  }
  function saveProjectBytes(): Uint8Array {
    if (!project.value) throw new Error('no-project');
    return writeBmh(project.value);
  }
  function cutTicks(): number[] {
    const division = selectedDivision.value;
    return division ? division.recording.map(note => Math.trunc(note.position * 48 / division.quantize)) : [];
  }
  function reset(): void { project.value = null; name.value = ''; selectedIndex.value = 0; dirty.value = false; }
  return { project, name, selectedIndex, selectedDivision, dirty, inspectMidi, importMidi, addDivision, selectDivision, deleteDivision, transpose, setStart, exportMidiBytes, openProject, saveProjectBytes, cutTicks, reset };
});
