import { describe, expect, it } from 'vitest';
import { createSingleTrackProject } from '../../src/project/codec';
import { ProjectEditor } from '../../src/project/editor';
import type { MediaAsset } from '../../src/project/schema';

function editor(): ProjectEditor {
  const media: MediaAsset = { mediaId: 'm1', name: 'audio.wav', format: 'wav', byteLength: 96044, sampleRateHz: 48000, channels: 1, framesPerChannel: 24000, integrity: null, originHint: { kind: 'desktop', pathHint: '/audio.wav' } };
  return new ProjectEditor(createSingleTrackProject({ projectId: 'p1', name: 'Song', mediaId: 'm1', media }));
}

describe('atomic project transactions', () => {
  it('prevents writes through committed snapshots and detaches drafts retained by a caller', () => {
    const project = editor();
    const before = project.document;
    expect(Reflect.set(before.timing, 'bpm', 240)).toBe(false);
    expect(Reflect.set(before.slicing.markers, '0', 12)).toBe(false);
    const { value: retained } = project.transact(draft => { draft.timing.bpm = 150; return draft; });
    retained.timing.bpm = 200; retained.slicing.markers.push(30);
    expect(project.document.timing.bpm).toBe(150);
    expect(project.document.slicing.markers).toEqual([]);
    project.undo(); expect(project.document).toEqual(before);
    project.redo(); expect(project.document.timing.bpm).toBe(150);
    expect(Reflect.set(project.document.output, 'baseName', 'bypassed')).toBe(false);
  });
  it('commits one atomic operation for slicing parameters and markers and undoes them together', () => {
    const project = editor();
    const result = project.transact(document => { document.timing.bpm = 140; document.slicing.markers = [12, 24]; });
    expect(result.changed).toBe(true);
    expect(project.document.timing.bpm).toBe(140);
    expect(project.document.slicing.markers).toEqual([12, 24]);
    expect(project.undo()).toBe(true);
    expect(project.document.timing.bpm).toBe(120);
    expect(project.document.slicing.markers).toEqual([]);
    expect(project.canRedo).toBe(true);
    expect(project.redo()).toBe(true);
    expect(project.document.timing.bpm).toBe(140);
    expect(project.document.slicing.markers).toEqual([12, 24]);
  });

  it('does not create history or discard redo on a no-op transaction', () => {
    const project = editor();
    project.transact(document => { document.slicing.markers = [12]; });
    project.undo();
    const result = project.transact(document => { document.name = document.name; });
    expect(result.changed).toBe(false);
    expect(project.canRedo).toBe(true);
    expect(project.document.slicing.markers).toEqual([]);
  });

  it('keeps cancelled drafts out of the document and rejects stale drafts after another command', () => {
    const project = editor();
    const cancelled = project.beginDraft();
    project.updateDraft(cancelled, draft => { draft.slicing.markers = [10]; });
    expect(project.document.slicing.markers).toEqual([]);
    const committed = project.commitDraft(cancelled);
    expect(committed.changed).toBe(true);
    expect(project.undo()).toBe(true);
    const stale = project.beginDraft();
    project.updateDraft(stale, draft => { draft.slicing.markers = [20]; });
    project.transact(draft => { draft.timing.shiftTicks = 4; });
    expect(() => project.commitDraft(stale)).toThrow(/changed during/);
    expect(project.document.slicing.markers).toEqual([]);
    expect(project.document.timing.shiftTicks).toBe(4);
  });

  it('tracks saved revisions and leaves newer edits dirty after an older save completes', () => {
    const project = editor();
    expect(project.isDirty).toBe(false);
    project.transact(document => { document.name = 'First'; });
    const savingRevision = project.revision;
    project.transact(document => { document.name = 'Second'; });
    expect(project.markSaved(savingRevision)).toBe(false);
    expect(project.isDirty).toBe(true);
    expect(project.markSaved(project.revision)).toBe(true);
    expect(project.isDirty).toBe(false);
  });

  it('rejects invalid drafts without changing the last committed document', () => {
    const project = editor();
    expect(() => project.transact(document => { document.tracks[0]!.gainDb = Number.NaN; })).toThrow();
    expect(project.document.tracks[0]?.gainDb).toBe(0);
    expect(project.canUndo).toBe(false);
  });
});
