/**
 * BMHelper panel controller: owns the project state (source sequence + the
 * division list) on the renderer side, independent of the slicer store — the
 * BMHelper workflow has its own data, its own dirty flag and its own
 * persistence. The DOM wiring lives in app.ts; this module is the state and
 * the actions, and stays unit-testable without a DOM.
 */

import {
  createDivision,
  nextZz,
  prevZz,
  setStartDefinition,
  type Division,
  type DivisionSetting,
} from "../core/bmhelper.js";
import { readBmh, writeBmh, type BmhProject } from "../core/bmh.js";
import { inspectSmf, readSmfSequence, writeSmfSequence, type MidiSequence, type SmfTrackInfo } from "../core/smf.js";

export interface BmhInspection {
  division: number;
  tracks: SmfTrackInfo[];
}

type Listener = () => void;

export class BmhController {
  private project: BmhProject | null = null;
  private sourceName = "";
  private selected = 0;
  private listeners: Listener[] = [];

  get state(): BmhProject | null {
    return this.project;
  }

  get name(): string {
    return this.sourceName;
  }

  get selectedIndex(): number {
    return this.selected;
  }

  get selectedDivision(): Division | null {
    return this.project?.divisions[this.selected] ?? null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** Lists the tracks of a MIDI file for the import dialog. */
  inspectMidi(bytes: Uint8Array): BmhInspection {
    const info = inspectSmf(bytes);
    if (info.tracks.every((track) => track.noteCount === 0)) {
      throw new Error("no-notes");
    }
    return info;
  }

  /** Builds the project from the chosen track/channels. */
  importMidi(bytes: Uint8Array, name: string, trackIndex: number, channels: ReadonlySet<number>): void {
    const source = readSmfSequence(bytes, trackIndex, channels);
    if (source.notes.length === 0) throw new Error("no-notes");
    this.project = { source, divisions: [] };
    this.sourceName = name.replace(/\.(mid|midi|smf)$/i, "");
    this.selected = 0;
    this.changed();
  }

  addDivision(source: MidiSequence, setting: DivisionSetting): void {
    if (!this.project) throw new Error("no-project");
    this.project.divisions.push(createDivision(source, setting));
    this.selected = this.project.divisions.length - 1;
    this.changed();
  }

  deleteDivision(index: number): void {
    if (!this.project) throw new Error("no-project");
    this.project.divisions.splice(index, 1);
    this.selected = Math.min(this.selected, Math.max(0, this.project.divisions.length - 1));
    this.changed();
  }

  selectDivision(index: number): void {
    this.selected = index;
    this.changed();
  }

  transpose(delta: 1 | -1): void {
    const division = this.selectedDivision;
    if (!division) return;
    for (const definition of division.definitions) {
      definition.zz = delta === 1 ? nextZz(definition.zz, !division.zzDefinition) : prevZz(definition.zz, !division.zzDefinition);
    }
    this.changed();
  }

  setStart(start: number): void {
    const division = this.selectedDivision;
    if (!division) return;
    setStartDefinition(division, start, !division.zzDefinition);
    this.changed();
  }

  /** The recording sequence as an exportable SMF file. */
  exportMidiBytes(): Uint8Array {
    const division = this.selectedDivision;
    if (!division) throw new Error("no-division");
    return writeSmfSequence({ quantize: division.quantize, notes: division.recording, pitches: [], controls: [] });
  }

  openProject(bytes: Uint8Array, name: string): void {
    const project = readBmh(bytes);
    if (project.source.notes.length === 0) throw new Error("no-notes");
    this.project = project;
    this.sourceName = name.replace(/\.bmh$/i, "");
    this.selected = 0;
    this.changed();
  }

  saveProjectBytes(): Uint8Array {
    if (!this.project) throw new Error("no-project");
    return writeBmh(this.project);
  }
}
