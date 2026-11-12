import { BAND_NAMES } from '../core/bands';
import { gridStepTicks } from '../core/gridlines';
import { MAX_TICKS } from '../core/timebase';
import type { AudioEngine } from '../audio/audio-jobs';
import type { EditorStore } from '../slicing/editor-store';

export function createDetection(editor: EditorStore, engine: () => AudioEngine | null, generation: () => number) {
  let analysisTask: { generation: number; task: Promise<void> } | null = null;
  function ensureBands(): Promise<void> {
    const worker = engine(), source = editor.source, version = generation();
    if (!worker || !source || editor.bandAnalysis) return Promise.resolve();
    if (analysisTask?.generation === version) return analysisTask.task;
    editor.bandBusy = true; editor.setStatus('analyzingBands');
    const task = worker.bands().then(analysis => {
      if (generation() === version) editor.setBandAnalysis(analysis);
    }).catch(error => {
      if (generation() === version) editor.setStatus('loadFailed', { message: error instanceof Error ? error.message : String(error) }, true);
    }).finally(() => { if (generation() === version) editor.bandBusy = false; if (analysisTask?.generation === version) analysisTask = null; });
    analysisTask = { generation: version, task };
    return task;
  }
  async function detect(): Promise<void> {
    const version = generation(), worker = engine();
    if (!editor.source || !worker) { editor.setStatus('bandDetectNeedsSource', true); return; }
    if (editor.bandBusy && !analysisTask) return;
    const bands = BAND_NAMES.filter(name => editor.bandDetectBands[name]);
    if (!bands.length) { editor.setStatus('bandDetectSelectBand', true); return; }
    await ensureBands();
    if (version !== generation() || !editor.bandAnalysis || !editor.source) return;
    const revision = editor.docRevision;
    const start = editor.selectionStartTick, end = editor.selectionEndTick;
    const cell = gridStepTicks(editor.grid), threshold = editor.bandThresholdDb;
    editor.bandBusy = true;
    try {
      const result = await worker.detect({ bands, thresholdDb: threshold, grid: cell, minGapTicks: cell * editor.bandMinGapUnits, fromTick: start === null || end === null ? 0 : Math.min(start, end), toTick: start === null || end === null ? MAX_TICKS - 1 : Math.max(start, end), base: { bpm: editor.doc.bpm, shift: editor.doc.shift, sampleRate: editor.source.sampleRate }, existing: new Set(editor.ticks), snap: editor.bandSnap });
      // An edit or source replacement while detecting invalidates its captured time base.
      if (generation() !== version || editor.docRevision !== revision) return;
      const legal = result.ticks.filter(editor.legalTick);
      const count = editor.addTicks(legal);
      editor.bandEstimate = count;
      editor.setStatus(count ? 'bandDetectCuts' : 'bandDetectZero', { count, bands: bands.join('/'), threshold });
    } catch (error) {
      if (generation() === version) editor.setStatus('loadFailed', { message: error instanceof Error ? error.message : String(error) }, true);
    } finally { if (generation() === version) editor.bandBusy = false; }
  }
  async function edgeDetect(): Promise<void> {
    const worker = engine(), source = editor.source, version = generation(), revision = editor.docRevision;
    if (!worker || !source) { editor.setStatus('edgeDetectionNeedsSource', true); return; }
    if (editor.bandBusy) return;
    editor.bandBusy = true;
    try {
      const ticks = await worker.edges({ bpm: editor.doc.bpm, shift: editor.doc.shift, sampleRate: source.sampleRate });
      if (version !== generation() || revision !== editor.docRevision) return;
      const legal = ticks.filter(editor.legalTick);
      editor.setTicks(legal);
      editor.setStatus('edgeDetectionCandidates', { count: legal.length });
    } catch (error) {
      if (generation() === version) editor.setStatus('loadFailed', { message: error instanceof Error ? error.message : String(error) }, true);
    } finally { if (generation() === version) editor.bandBusy = false; }
  }
  return { ensureBands, detect, edgeDetect };
}
