import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReactive } from 'vue';
import { fixture, audioFile, processorEngine } from './workspace-fixture';
import {
  captureEditorSession,
  parseEditorSession,
  readEditorSession,
} from '../../src/workspace/session';
import { renderSliceFiles } from '../../src/core/slices';
import { detectEdges } from '../../src/core/edge';
import { encodeWav16 } from '../../src/core/wav';
import { readWos, writeWos } from '../../src/core/wos';
import type { DecodedAudio } from '../../src/audio/audio-jobs';
import { createEmptyProject, encodeProject, projectToWos } from '../../src/project/codec';
import { createTimelineGestures } from '../../src/timeline/gestures';
import { createCommands } from '../../src/app/commands';
import type { Playback } from '../../src/playback';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup(createEngine = processorEngine) {
  const f = fixture(createEngine);
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
});

describe('workspace and editor business operations', () => {
  it('keeps playback properties in document history with one transaction per change', () => {
    const { editor, workspace } = setup();
    editor.setDocumentOptions({ bpm: 160, fadeoutMs: 40 });
    editor.setVolume(0.2);
    expect(editor.isDirty).toBe(true);
    expect(workspace.actions.undo()).toBe(true);
    expect(editor.doc.bpm).toBe(160);
    expect(editor.doc.fadeoutMs).toBe(40);
    expect(editor.volume).toBeCloseTo(Math.pow(10, -10 / 20), 12);
    workspace.actions.undo();
    expect(editor.doc.bpm).toBe(120);
    expect(editor.doc.fadeoutMs).toBe(0);
  });
  it('commits parameters, output recipe and cuts as one operation and leaves no-op history untouched', () => {
    const { editor, workspace } = setup();
    const original = editor.document;
    const revision = editor.docRevision;
    editor.transact((draft) => {
      draft.timing.bpm = 160;
      draft.slicing.markers = [24, 48];
      draft.slicing.noisegateEnabled = false;
      draft.output.baseName = 'recording';
    });
    expect(editor.docRevision).toBe(revision + 1);
    expect(editor.doc.bpm).toBe(160);
    expect(editor.baseName).toBe('recording');
    workspace.actions.undo();
    expect(editor.document).toEqual(original);
    expect(editor.canUndo).toBe(false);
    const undoneRevision = editor.docRevision;
    editor.setDocumentOptions({ bpm: 120 });
    editor.setTicks([]);
    expect(editor.docRevision).toBe(undoneRevision);
    expect(editor.canRedo).toBe(true);
    workspace.actions.redo();
    expect(editor.ticks).toEqual([24, 48]);
    expect(editor.noisegateEnabled).toBe(false);
  });
  it('ignores keyboard commands while a modal dialog is open', () => {
    const f = setup();
    const playback: Playback = {
      play() {},
      pause() {},
      stop() {},
      togglePlayPause() {},
      seekSample() {},
      currentSample: () => 0,
      setRate() {},
      previewSlice() {},
      getAudioContext() {
        throw new Error('unused');
      },
      dispose() {},
    };
    const commands = createCommands({
      editor: f.editor,
      workspace: f.workspace,
      playback,
      onClose() {},
      onAbout() {},
    });
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    document.body.appendChild(overlay);
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([new DOMRect(0, 0, 320, 200)]);
    try {
      const event = new KeyboardEvent('keydown', { key: 'z', cancelable: true });
      commands.onKeyDown(event);
      expect(event.defaultPrevented).toBe(false);
      expect(f.editor.ticks).toEqual([]);
    } finally {
      rects.mockRestore();
      overlay.remove();
    }
  });
  it('cancels an active paint gesture when the project is replaced mid-stroke', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.editor.pxPerTick = 1;
    f.workspace.actions.setMarker(0);
    const gestures = createTimelineGestures(f.editor);
    try {
      await f.workspace.flushSession();
      const point = { x: 48, y: 10, button: 0, altKey: false, shiftKey: false, ctrlKey: false };
      gestures.begin(point);
      gestures.move({ ...point, x: 120 });
      expect(f.editor.previewTicks).not.toBeNull();
      f.opened = {
        name: 'empty.wosdx',
        reference: null,
        bytes: encodeProject(createEmptyProject('replacement')),
      };
      await f.workspace.openProject();
      expect(f.editor.previewTicks).toBeNull();
      gestures.end({ ...point, x: 120 });
      expect(f.editor.document.projectId).toBe('replacement');
      expect(f.editor.ticks).toEqual([]);
      expect(f.editor.canUndo).toBe(false);
    } finally {
      gestures.dispose();
      vi.useRealTimers();
    }
  });
  it('refuses re-entrant detection and export while their busy flags hold', async () => {
    const f = setup();
    await f.workspace.loadAudio(audioFile());
    f.workspace.actions.setMarker(12);
    let complete: (() => void) | undefined;
    let started = 0;
    f.platform.exportFiles = () => {
      started++;
      return new Promise((resolve) => {
        complete = () => resolve(1);
      });
    };
    const exporting = f.workspace.exportAll();
    expect(f.editor.exportLock).toBe(true);
    await f.workspace.exportAll(); // re-entry is a no-op while the first export holds
    expect(started).toBe(1);
    if (!complete) throw new Error('Expected a pending export');
    complete();
    await exporting;
    expect(f.editor.exportLock).toBe(false);
  });
  it('measures bounded undo history over a large marker set', () => {
    const f = setup();
    const markers = Array.from({ length: 2000 }, (_, index) => index * 20 + 1);
    f.editor.setTicks(markers);
    const started = performance.now();
    for (let step = 0; step < 200; step++) f.editor.setDocumentOptions({ bpm: 120 + (step % 10) });
    const historyMs = performance.now() - started;
    expect(f.editor.canUndo).toBe(true);
    expect(f.editor.canRedo).toBe(false);
    const redoStarted = performance.now();
    for (let step = 0; step < 200; step++) f.workspace.actions.undo();
    const undoMs = performance.now() - redoStarted;
    expect(f.editor.canRedo).toBe(true);
    expect(f.editor.doc.bpm).toBe(120);
    // Informational budget for the approved immutable-snapshot model: guard
    // against order-of-magnitude regressions rather than machine speed.
    expect(historyMs).toBeLessThan(20000);
    expect(undoMs).toBeLessThan(20000);
  });
  it.each([false, true])(
    'cancels a paint draft before a real keyboard command (undo=%s)',
    async (ctrlKey) => {
      const f = setup();
      f.editor.pxPerTick = 1;
      f.workspace.actions.setMarker(0);
      const gestures = createTimelineGestures(f.editor);
      const point = { x: 48, y: 10, button: 0, altKey: false, shiftKey: false, ctrlKey: false };
      const playback: Playback = {
        play() {},
        pause() {},
        stop() {},
        togglePlayPause() {},
        seekSample() {},
        currentSample: () => 0,
        setRate() {},
        previewSlice() {},
        getAudioContext() {
          throw new Error('Audio is not used by marker commands');
        },
        dispose() {},
      };
      const commands = createCommands({
        editor: f.editor,
        workspace: f.workspace,
        playback,
        onClose() {},
        onAbout() {},
      });
      gestures.begin(point);
      gestures.move({ ...point, x: 120 });
      f.editor.setCursorTick(200);
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey, cancelable: true });
      commands.onKeyDown(event);
      await Promise.resolve();
      expect(event.defaultPrevented).toBe(true);
      expect(f.editor.previewTicks).toBeNull();
      gestures.end({ ...point, x: 120 });
      expect(f.editor.ticks).toEqual(ctrlKey ? [] : [0, 200]);
      if (ctrlKey) {
        f.workspace.actions.redo();
        expect(f.editor.ticks).toEqual([0]);
      } else {
        f.workspace.actions.undo();
        expect(f.editor.ticks).toEqual([0]);
      }
      gestures.dispose();
    },
  );
  it('autosaves only committed cuts while a pointer stroke remains active', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.editor.pxPerTick = 1;
    f.workspace.actions.setMarker(0);
    const gestures = createTimelineGestures(f.editor);
    try {
      await f.workspace.flushSession();
      const revision = f.editor.docRevision;
      const point = { x: 48, y: 10, button: 0, altKey: false, shiftKey: false, ctrlKey: false };
      gestures.begin(point);
      gestures.move({ ...point, x: 120 });
      expect(f.editor.previewTicks).toEqual([0, 48, 72, 96, 120]);
      await vi.advanceTimersByTimeAsync(650);
      expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([0]);
      expect(f.editor.docRevision).toBe(revision);
      gestures.cancel();
      await f.workspace.flushSession();
      expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([0]);
      f.workspace.actions.undo();
      expect(f.editor.ticks).toEqual([]);
      expect(f.editor.canUndo).toBe(false);
    } finally {
      gestures.dispose();
      vi.useRealTimers();
    }
  });
  it('keeps redo after a marker command that changes nothing', () => {
    const { editor, workspace } = setup();
    workspace.actions.setMarker(24);
    workspace.actions.undo();
    workspace.actions.measureCut();
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    workspace.actions.redo();
    expect(editor.ticks).toEqual([24]);
  });
  it('decodes PCM, builds peaks, keeps buffers raw, and keeps cuts when changing audio', async () => {
    const { editor, workspace } = setup();
    workspace.actions.setMarker(24);
    await workspace.loadAudio(audioFile());
    expect(editor.source?.sampleRate).toBe(48000);
    expect(editor.peaks).not.toBeNull();
    expect(editor.phase.kind).toBe('ready');
    expect(isReactive(editor.source)).toBe(false);
    expect(isReactive(editor.doc)).toBe(false);
    await workspace.loadAudio(audioFile('other.wav'));
    expect(editor.ticks).toEqual([24]);
    expect(editor.baseName).toBe('other');
  });
  it('uses group clipboard collision checks and a single undo entry for quantize', () => {
    const { editor, workspace } = setup(),
      actions = workspace.actions;
    editor.addTicks([10, 34, 100]);
    editor.setSelectedTicks([10, 34]);
    actions.copySelection();
    editor.setCursorTick(100);
    expect(actions.pasteSelection()).toBe(false);
    editor.setCursorTick(150);
    expect(actions.pasteSelection()).toBe(true);
    expect(editor.selectedTicks).toEqual([150, 174]);
    actions.undo();
    expect(editor.ticks).toEqual([10, 34, 100]);
    editor.setSelectedTicks([10, 34]);
    actions.quantizeSelection();
    expect(editor.ticks).toEqual([0, 24, 100]);
    actions.undo();
    expect(editor.ticks).toEqual([10, 34, 100]);
  });
  it('rejects entire quantize/paste groups beyond EOF without altering undo history', async () => {
    const { editor, workspace } = setup();
    await workspace.loadAudio(audioFile('short.wav', 22000));
    workspace.actions.setMarker(43);
    editor.setSelectedTicks([43]);
    const before = editor.ticks;
    expect(workspace.actions.quantizeSelection()).toBe(false);
    expect(editor.ticks).toEqual(before);
    workspace.actions.copySelection();
    editor.setCursorTick(46);
    expect(workspace.actions.pasteSelection()).toBe(false);
    workspace.actions.undo();
    expect(editor.ticks).toEqual([]);
  });
  it('exports one slice at a time byte-identically, preserving EOF empty output and skip numbering', async () => {
    const f = setup();
    await f.workspace.loadAudio(audioFile());
    f.editor.setNoisegateEnabled(false);
    f.editor.addTicks([0, 48, 96, 120]);
    const source = f.editor.source;
    if (!source) throw new Error('Expected source');
    const expected = renderSliceFiles(source, {
      baseName: 'tone',
      bpm: 120,
      shift: 0,
      fadeoutMs: 0,
      noisegateDb: 0,
      markers: f.editor.ticks,
    });
    await f.workspace.exportAll();
    expect(f.exported.map((file) => file.name)).toEqual(expected.files.map((file) => file.name));
    for (let i = 0; i < f.exported.length; i++)
      expect(f.exported[i].bytes).toEqual(expected.files[i].data);
    expect(f.exported[2].bytes.byteLength).toBe(44);
    expect(f.editor.exportLock).toBe(false);
    expect(f.editor.status.segments.some((segment) => segment.key === 'exportSkippedBeyond')).toBe(
      true,
    );
  });
  it('rejects fractional WOS gate, then saves exact original format and resets undo on load', async () => {
    const f = setup();
    f.workspace.actions.setMarker(5);
    f.editor.setDocumentOptions({ noisegateDb: -48.5 });
    await f.workspace.saveWos();
    expect(f.saved).toHaveLength(0);
    expect(f.editor.isError).toBe(true);
    f.editor.setDocumentOptions({ noisegateDb: -48 });
    await f.workspace.saveWos();
    expect(f.saved[0].bytes).toEqual(writeWos(projectToWos(f.editor.document)));
    expect(readWos(f.saved[0].bytes).markers[5]).toBe(1);
    f.opened = { name: 'saved.wos', bytes: f.saved[0].bytes, reference: null };
    await f.workspace.newProjectFromWos();
    expect(f.editor.canUndo).toBe(false);
    expect(f.editor.ticks).toEqual([5]);
    expect(f.editor.canRedo).toBe(false);
    expect(f.editor.document.media).toEqual([]);
    expect(f.editor.document.tracks).toHaveLength(1);
    expect(f.editor.document.tracks[0]?.clips).toEqual([]);
  });
  it('restores versioned sessions and custom export prefix without persisting dropped bytes', async () => {
    const f = setup(),
      file = audioFile();
    await f.workspace.loadAudio(file);
    f.editor.setOutputOptions({ baseName: 'custom' });
    f.workspace.actions.setMarker(20);
    await f.workspace.flushSession();
    const session = f.session;
    expect(parseEditorSession(session)?.version).toBe(2);
    const restored = setup();
    restored.session = session;
    restored.opened = file;
    await restored.workspace.restoreSession();
    expect(restored.editor.baseName).toBe('custom');
    expect(restored.editor.ticks).toEqual([20]);
    expect(restored.editor.source?.reference).toBe(file.reference);
    expect(restored.editor.canUndo).toBe(false);
    expect(restored.editor.canRedo).toBe(false);
    await f.workspace.loadAudio({ ...file, reference: null });
    expect(captureEditorSession(f.editor).lastFile).toBeNull();
    expect(JSON.stringify(captureEditorSession(f.editor))).not.toContain('floatData');
  });
  it('rejects unsupported session versions and invalid numeric document inputs', () => {
    const f = setup(),
      s = captureEditorSession(f.editor);
    expect(parseEditorSession({ ...s, version: 99 })).toBeNull();
    expect(
      parseEditorSession({ ...s, project: { ...s.project, timing: { bpm: 0, shiftTicks: 0 } } }),
    ).toBeNull();
    expect(
      parseEditorSession({
        ...s,
        project: { ...s.project, slicing: { ...s.project.slicing, markers: [0, 0, -1] } },
      }),
    ).toBeNull();
    const parsed = parseEditorSession({
      version: 1,
      options: { grid: 7, volume: 999 },
      doc: { bpm: 120, shift: 0, fadeoutMs: 0, noisegateDb: -48, markers: [0, 0, -1, 3.2, 49152] },
    });
    expect(parsed?.project.slicing.markers).toEqual([0]);
    expect(parsed?.options.grid).toBeUndefined();
    expect(parsed?.options.volume).toBeUndefined();
  });
  it.each([undefined, 1])(
    'migrates legacy recovery version %s without granting access to its path',
    async (version) => {
      const f = setup();
      f.session = {
        version,
        doc: { bpm: 145, shift: 2, fadeoutMs: 20, noisegateDb: -52, markers: [12, 36] },
        options: {
          volume: 0.2,
          baseName: 'legacy',
          clipStartNumber: 16,
          useFfNumbering: true,
          noisegateEnabled: false,
        },
        lastFile: { path: 'C:/untrusted/audio.wav', name: 'audio.wav' },
      };
      const reopen = vi.spyOn(f.platform, 'reopenFile');
      await f.workspace.restoreSession();
      expect(f.editor.doc).toEqual({ bpm: 145, shift: 2, fadeoutMs: 20, noisegateDb: -52 });
      expect(f.editor.document.output).toEqual({
        baseName: 'legacy',
        clipStartNumber: 16,
        useFfNumbering: true,
      });
      expect(f.editor.noisegateEnabled).toBe(false);
      expect(f.editor.volume).toBeCloseTo(0.2, 12);
      expect(f.editor.ticks).toEqual([12, 36]);
      expect(f.editor.canUndo).toBe(false);
      expect(reopen).not.toHaveBeenCalled();
      expect(f.editor.document.media).toEqual([]);
    },
  );
  it('keeps the last-file binding when reopening fails so the next archive still carries it', async () => {
    const f = setup();
    const file = audioFile();
    await f.workspace.loadAudio(file);
    f.editor.setDocumentOptions({ bpm: 150 });
    await f.workspace.flushSession();
    const snapshot = f.session;
    expect(parseEditorSession(snapshot)?.lastFile).toEqual({
      reference: file.reference,
      name: 'tone',
    });
    const restored = setup();
    restored.session = JSON.parse(JSON.stringify(snapshot));
    restored.platform.reopenFile = () => Promise.reject(new Error('Missing source'));
    await restored.workspace.restoreSession();
    expect(restored.editor.source).toBeNull();
    expect(restored.editor.isError).toBe(true);
    expect(restored.editor.doc.bpm).toBe(150);
    restored.editor.setTicks([1]);
    await restored.workspace.flushSession();
    expect(parseEditorSession(restored.session)?.lastFile).toEqual({
      reference: file.reference,
      name: 'tone',
    });
  });
  it('rebuilds audio from the binding without resetting project identity or dirty state', async () => {
    const f = setup();
    const file = audioFile();
    await f.workspace.loadAudio(file);
    const projectId = f.editor.document.projectId;
    f.editor.setDocumentOptions({ bpm: 150 });
    const snapshot = captureEditorSession(f.editor);
    const restored = setup();
    restored.session = JSON.parse(JSON.stringify(snapshot));
    restored.opened = file;
    await restored.workspace.restoreSession();
    expect(restored.editor.source?.reference).toBe(file.reference);
    expect(restored.editor.document.projectId).toBe(projectId);
    expect(restored.editor.document.media).toEqual(snapshot.project.media);
    expect(restored.editor.isDirty).toBe(true);
    expect(restored.editor.canUndo).toBe(false);
    expect(restored.editor.lastFile).toEqual({ reference: file.reference, name: 'tone' });
  });
  it('restores the entire committed project and independent session controls with fresh history', async () => {
    const f = setup();
    f.editor.transact((draft) => {
      draft.name = 'Recovery';
      draft.slicing.markers = [12];
      draft.output.baseName = 'custom';
      draft.media = [
        {
          mediaId: 'm1',
          name: 'missing.wav',
          format: 'wav',
          byteLength: 1000,
          sampleRateHz: 48000,
          channels: 1,
          framesPerChannel: 400,
          integrity: null,
          originHint: null,
        },
      ];
      const track = draft.tracks[0];
      if (!track) throw new Error('Missing default track');
      track.clips = [
        {
          clipId: 'c1',
          mediaId: 'm1',
          timelineStartSeconds: 0,
          sourceOffsetFrames: 0,
          frameCount: 400,
        },
      ];
      draft.bmhelper = {
        format: 'bmhelper',
        source: { quantize: 480, notes: [], pitches: [], controls: [] },
        divisions: [],
      };
    });
    f.editor.setSelectedTicks([12]);
    f.editor.setCursorTick(12);
    f.editor.scrollTick = 4;
    f.editor.rmsVisible = true;
    f.editor.volume = 0.2;
    f.editor.playbackRate = 0.5;
    const snapshot = captureEditorSession(f.editor);
    f.editor.setTicks([24]);
    expect(snapshot.project.slicing.markers).toEqual([12]);
    const restored = setup();
    restored.session = JSON.parse(JSON.stringify(snapshot));
    await restored.workspace.restoreSession();
    expect(restored.editor.document).toEqual(snapshot.project);
    expect(restored.editor.source).toBeNull();
    expect(restored.editor.canUndo).toBe(false);
    expect(restored.editor.selectedTicks).toEqual([12]);
    expect(restored.editor.cursorTick).toBe(12);
    expect(restored.editor.scrollTick).toBe(4);
    expect(restored.editor.rmsVisible).toBe(true);
    expect(restored.editor.volume).toBeCloseTo(0.2, 12);
    expect(restored.editor.playbackRate).toBe(0.5);
    restored.editor.setDocumentOptions({ bpm: 180 });
    restored.workspace.actions.undo();
    expect(restored.editor.document).toEqual(snapshot.project);
    expect(restored.editor.volume).toBeCloseTo(0.2, 12);
  });
  it('does not let a late decode resurrect audio after reset', async () => {
    let complete: ((result: DecodedAudio) => void) | undefined;
    const result = await processorEngine().decode('tone.wav', audioFile().bytes);
    const f = setup(() => ({
      ...processorEngine(),
      decode: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    }));
    const loading = f.workspace.loadAudio(audioFile());
    expect(f.editor.phase.kind).toBe('loading');
    await vi.waitFor(() => expect(complete).toBeDefined());
    await f.workspace.reset();
    if (!complete) throw new Error('Expected pending decode');
    complete(result);
    await loading;
    expect(f.editor.source).toBeNull();
    expect(f.editor.phase.kind).toBe('empty');
    expect(f.session).toBeNull();
    await f.workspace.flushSession();
    expect(f.session).toBeNull();
  });
  it('serializes a reset behind already-running session writes', async () => {
    const f = setup();
    let release: (() => void) | undefined;
    f.platform.writeSession = (value) =>
      new Promise<void>((resolve) => {
        release = () => {
          f.session = value;
          resolve();
        };
      });
    f.workspace.actions.setMarker(5);
    const saving = f.workspace.flushSession();
    await Promise.resolve();
    await Promise.resolve();
    const resetting = f.workspace.reset();
    if (!release) throw new Error('Expected pending write');
    release();
    await saving;
    await resetting;
    expect(f.session).toBeNull();
    expect(f.editor.ticks).toEqual([]);
  });
  it('reports a failed recovery write and retries the same content without new edits', async () => {
    vi.useFakeTimers();
    const f = setup();
    let attempts = 0;
    let failing = true;
    f.platform.writeSession = (value) => {
      attempts++;
      if (failing) return Promise.reject(new Error('storage unavailable'));
      f.session = value;
      return Promise.resolve();
    };
    try {
      f.workspace.actions.setMarker(5);
      await vi.advanceTimersByTimeAsync(650);
      expect(attempts).toBe(1);
      expect(f.session).toBeNull();
      expect(f.editor.status.segments.some((segment) => segment.key === 'sessionSaveFailed')).toBe(
        true,
      );
      failing = false;
      await f.workspace.flushSession();
      expect(attempts).toBe(2);
      expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([5]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps edits made during a failed write pending and retries the newest snapshot', async () => {
    const f = setup();
    let attempts = 0;
    let failing = true;
    f.platform.writeSession = (value) => {
      attempts++;
      if (failing) return Promise.reject(new Error('write rejected'));
      f.session = value;
      return Promise.resolve();
    };
    f.workspace.actions.setMarker(5);
    const first = f.workspace.flushSession();
    await Promise.resolve();
    await Promise.resolve();
    f.editor.setDocumentOptions({ bpm: 200 });
    await expect(first).rejects.toThrow('write rejected');
    expect(f.session).toBeNull();
    expect(attempts).toBe(1);
    failing = false;
    await f.workspace.flushSession();
    expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([5]);
    expect(parseEditorSession(f.session)?.project.timing.bpm).toBe(200);
  });
  it('keeps newer edits pending when an older write settles first', async () => {
    const f = setup();
    let release: (() => void) | undefined;
    let subsequent = false;
    f.platform.writeSession = (value) =>
      new Promise<void>((resolve) => {
        if (subsequent) {
          f.session = value;
          resolve();
          return;
        }
        release = () => {
          f.session = value;
          resolve();
        };
      });
    f.workspace.actions.setMarker(5);
    const saving = f.workspace.flushSession();
    await Promise.resolve();
    await Promise.resolve();
    f.editor.setDocumentOptions({ bpm: 200 });
    if (!release) throw new Error('Expected pending write');
    release();
    await saving;
    expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([5]);
    subsequent = true;
    await f.workspace.flushSession();
    expect(parseEditorSession(f.session)?.project.timing.bpm).toBe(200);
  });
  it('surfaces a failing final write from dispose instead of reporting success', async () => {
    const f = setup();
    f.platform.writeSession = () => Promise.reject(new Error('gone'));
    f.workspace.actions.setMarker(3);
    await expect(f.workspace.dispose()).rejects.toThrow('gone');
    expect(f.editor.status.segments.some((segment) => segment.key === 'sessionSaveFailed')).toBe(
      true,
    );
  });
  it('imports a legacy recovery file only after explicit confirmation without honoring its path', async () => {
    const f = setup();
    f.confirmOptions.confirmLegacyImport = (summary) => {
      expect(summary).toMatchObject({ bpm: 145, shift: 2, markers: 2, name: 'Untitled' });
      return Promise.resolve(true);
    };
    f.platform.importLegacySession = () =>
      Promise.resolve({
        version: 1,
        session: {
          doc: { bpm: 145, shift: 2, fadeoutMs: 20, noisegateDb: -52, markers: [12, 36] },
          options: { volume: 0.2, baseName: 'legacy' },
          lastFile: { path: 'C:/private/audio.wav', name: 'audio.wav' },
        },
      });
    const reopen = vi.spyOn(f.platform, 'reopenFile');
    await f.workspace.importLegacyRecovery();
    expect(f.editor.doc).toEqual({ bpm: 145, shift: 2, fadeoutMs: 20, noisegateDb: -52 });
    expect(f.editor.document.output).toEqual({
      baseName: 'legacy',
      clipStartNumber: 1,
      useFfNumbering: false,
    });
    expect(f.editor.ticks).toEqual([12, 36]);
    expect(f.editor.canUndo).toBe(false);
    expect(f.editor.volume).toBeCloseTo(0.2, 12);
    expect(reopen).not.toHaveBeenCalled();
    await f.workspace.flushSession();
    const archived = parseEditorSession(f.session);
    expect(archived?.lastFile).toBeNull();
    expect(archived?.project.slicing.markers).toEqual([12, 36]);
  });
  it('declines a legacy import or rejects non-legacy files without touching the workspace', async () => {
    const f = setup();
    f.platform.importLegacySession = () => Promise.resolve({ hello: 'world' });
    await f.workspace.importLegacyRecovery();
    expect(f.editor.isError).toBe(true);
    const document = f.editor.document;
    f.platform.importLegacySession = () =>
      Promise.resolve({
        version: 1,
        session: {
          doc: { bpm: 90, shift: 0, fadeoutMs: 0, noisegateDb: -48, markers: [3] },
          options: {},
        },
      });
    f.confirmOptions.confirmLegacyImport = () => Promise.resolve(false);
    await f.workspace.importLegacyRecovery();
    expect(f.editor.document).toBe(document);
    expect(f.editor.canUndo).toBe(false);
  });
  it('classifies recovery reads as absent, restored, damaged or future without reinterpretation', () => {
    expect(readEditorSession(null)).toEqual({ kind: 'absent' });
    expect(readEditorSession(undefined)).toEqual({ kind: 'absent' });
    expect(readEditorSession('junk')).toEqual({ kind: 'invalid', raw: 'junk' });
    const f = setup();
    const valid = captureEditorSession(f.editor);
    const restored = readEditorSession(JSON.parse(JSON.stringify(valid)));
    expect(restored.kind).toBe('restored');
    if (restored.kind === 'restored') expect(restored.session.project).toEqual(valid.project);
    const future = { version: 3, note: 'newer' };
    expect(readEditorSession(future)).toEqual({ kind: 'future', raw: future, version: 3 });
    const damaged = { version: 2, project: { timing: { bpm: 0, shiftTicks: 0 } } };
    const read = readEditorSession(damaged);
    expect(read.kind).toBe('invalid');
    if (read.kind === 'invalid') expect(read.raw).toBe(damaged);
  });
  it('keeps a damaged recovery record unchanged and pauses recovery writes', async () => {
    const f = setup();
    const raw = { version: 2, project: { timing: { bpm: 0, shiftTicks: 0 } } };
    f.session = raw;
    await f.workspace.restoreSession();
    expect(
      f.editor.status.segments.some((segment) => segment.key === 'sessionRecoverInvalid'),
    ).toBe(true);
    expect(f.editor.ticks).toEqual([]);
    expect(f.editor.canUndo).toBe(false);
    const write = vi.spyOn(f.platform, 'writeSession');
    f.workspace.actions.setMarker(5);
    await f.workspace.flushSession();
    expect(write).not.toHaveBeenCalled();
    expect(f.session).toBe(raw);
  });
  it('keeps a future recovery record with its version visible and recovery paused', async () => {
    const f = setup();
    const raw = { version: 7, project: {} };
    f.session = raw;
    await f.workspace.restoreSession();
    expect(
      f.editor.status.segments.some(
        (segment) => segment.key === 'sessionRecoverFuture' && segment.params?.version === 7,
      ),
    ).toBe(true);
    f.editor.setDocumentOptions({ bpm: 200 });
    await f.workspace.flushSession();
    expect(f.session).toBe(raw);
  });
  it('keeps recovery paused when the recovery record cannot be read', async () => {
    const f = setup();
    f.platform.readSession = () => Promise.reject(new Error('storage busy'));
    const write = vi.spyOn(f.platform, 'writeSession');
    await f.workspace.restoreSession();
    expect(
      f.editor.status.segments.some(
        (segment) =>
          segment.key === 'sessionRecoverReadFailed' && segment.params?.message === 'storage busy',
      ),
    ).toBe(true);
    f.workspace.actions.setMarker(5);
    await f.workspace.flushSession();
    expect(write).not.toHaveBeenCalled();
    expect(f.session).toBeNull();
  });
  it('opens content over a blocked record only after explicit confirmation', async () => {
    const f = setup();
    const raw = { version: 2, project: { timing: { bpm: 0, shiftTicks: 0 } } };
    f.session = raw;
    await f.workspace.restoreSession();
    const openFile = vi.spyOn(f.platform, 'openFile');
    await f.workspace.openAudio();
    expect(openFile).not.toHaveBeenCalled();
    expect(f.session).toBe(raw);
    f.confirmOptions.confirmDiscardRecovery = () => Promise.resolve(false);
    await f.workspace.openAudio();
    expect(openFile).not.toHaveBeenCalled();
    expect(f.session).toBe(raw);
    f.confirmOptions.confirmDiscardRecovery = () => Promise.resolve(true);
    f.opened = audioFile();
    await f.workspace.openAudio();
    expect(f.editor.source?.name).toBe('tone');
    await f.workspace.flushSession();
    expect(f.session).not.toBe(raw);
    expect(parseEditorSession(f.session)).not.toBeNull();
  });
  it('lets an explicit close discard a blocked record and resume archiving', async () => {
    const f = setup();
    const raw = { version: 2, project: { timing: { bpm: 0, shiftTicks: 0 } } };
    f.session = raw;
    await f.workspace.restoreSession();
    const confirm = vi.fn(() => Promise.resolve(false));
    f.confirmOptions.confirmDiscardRecovery = confirm;
    await f.workspace.reset();
    expect(confirm).not.toHaveBeenCalled();
    expect(f.session).toBeNull();
    f.workspace.actions.setMarker(5);
    await f.workspace.flushSession();
    expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([5]);
  });
  it('imports BMSE cuts as one undo operation and preserves the clip numbering text', async () => {
    const f = setup();
    f.workspace.actions.setMarker(0);
    f.workspace.actions.setMarker(24);
    f.editor.setOutputOptions({ clipStartNumber: 16, useFfNumbering: true });
    await f.workspace.bmseOut();
    expect(await f.platform.readClipboard()).toContain('1010000000036');
    f.workspace.actions.clearMarkers();
    await f.workspace.bmseIn();
    expect(f.editor.ticks).toEqual([0, 24]);
    f.workspace.actions.undo();
    expect(f.editor.ticks).toEqual([]);
  });
  it('detects real burst onsets in one undo transaction and preserves legacy edge detection', async () => {
    const f = setup();
    const pcm = new Int16Array(96000);
    for (const start of [12000, 48000, 72000])
      for (let i = start; i < start + 4800; i++) pcm[i] = Math.round(Math.sin(i / 9) * 18000);
    await f.workspace.loadAudio({
      name: 'bursts.wav',
      reference: null,
      bytes: encodeWav16([pcm], 48000, pcm.length),
    });
    f.editor.bandSnap = false;
    await f.workspace.detect();
    expect(f.editor.ticks.length).toBeGreaterThan(0);
    expect(f.editor.ticks.every(f.editor.legalTick)).toBe(true);
    f.workspace.actions.undo();
    expect(f.editor.ticks).toEqual([]);
    const source = f.editor.source;
    if (!source) throw new Error('Expected source');
    const expected = detectEdges(source, { bpm: 120, shift: 0, sampleRate: 48000 }, 4).filter(
      f.editor.legalTick,
    );
    await f.workspace.edgeDetect();
    expect(f.editor.ticks).toEqual(expected);
    f.workspace.actions.undo();
    expect(f.editor.ticks).toEqual([]);
  });
  it('keeps a reset archive empty when an older restore returns later', async () => {
    const f = setup();
    let complete: ((value: unknown) => void) | undefined;
    const snapshot = captureEditorSession(f.editor);
    f.platform.readSession = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    const restoring = f.workspace.restoreSession();
    await f.workspace.reset();
    if (!complete) throw new Error('Expected pending restore');
    complete(snapshot);
    await restoring;
    await f.workspace.flushSession();
    expect(f.session).toBeNull();
    expect(f.editor.source).toBeNull();
  });
  it('starts archiving later edits after reset without recreating an untouched empty archive', async () => {
    const f = setup();
    await f.workspace.reset();
    await f.workspace.flushSession();
    expect(f.session).toBeNull();
    f.workspace.actions.setMarker(12);
    await f.workspace.flushSession();
    expect(parseEditorSession(f.session)?.project.slicing.markers).toEqual([12]);
  });
  it('stops an old export iterator before it can render from a replacement source', async () => {
    const f = setup();
    await f.workspace.loadAudio(audioFile());
    f.editor.addTicks([0, 48]);
    let continuationRejected = false;
    f.platform.exportFiles = async (files) => {
      const iterator = files[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      await f.workspace.loadAudio(audioFile('replacement.wav'));
      try {
        await iterator.next();
      } catch {
        continuationRejected = true;
      }
      return 1;
    };
    await f.workspace.exportAll();
    expect(continuationRejected).toBe(true);
    expect(f.editor.source?.name).toBe('replacement');
    expect(f.editor.isError).toBe(false);
  });
  it('ignores late detection results when the time base was edited', async () => {
    let complete:
      | ((value: { ticks: number[]; skippedGap: number; existing: number; onsets: number }) => void)
      | undefined;
    const f = setup(() => ({
      ...processorEngine(),
      detect: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    }));
    await f.workspace.loadAudio(audioFile());
    await f.workspace.ensureBands();
    const detecting = f.workspace.detect();
    await Promise.resolve();
    await Promise.resolve();
    f.editor.setDocumentOptions({ bpm: 180 });
    if (!complete) throw new Error('Expected pending detection');
    complete({ ticks: [24], skippedGap: 0, existing: 0, onsets: 1 });
    await detecting;
    expect(f.editor.ticks).toEqual([]);
    expect(f.editor.bandBusy).toBe(false);
  });
  it('does not render any output when the host cancels destination selection', async () => {
    let renders = 0;
    const f = setup(() => {
      const engine = processorEngine();
      return {
        ...engine,
        async slice(params) {
          renders++;
          return engine.slice(params);
        },
      };
    });
    await f.workspace.loadAudio(audioFile());
    f.workspace.actions.setMarker(0);
    f.platform.exportFiles = () => Promise.resolve(null);
    await f.workspace.exportAll();
    expect(renders).toBe(0);
    expect(f.editor.exportLock).toBe(false);
  });
});
