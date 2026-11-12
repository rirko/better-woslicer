import { tickToSampleExport } from '../core/timebase';
import type { Platform, OutputFile } from '../platform/contracts';
import type { AudioEngine } from '../audio/audio-jobs';
import type { EditorStore } from '../slicing/editor-store';

export function createExporter(
  platform: Platform,
  editor: EditorStore,
  engine: () => AudioEngine | null,
  generation: () => number,
) {
  async function run(single: boolean): Promise<void> {
    const s = editor;
    if (s.exportLock) return;
    const source = s.source;
    const worker = engine();
    if (!source || !worker) {
      editor.setStatus('nothingToExportNoSource', true);
      return;
    }
    const sourceLength = source.length;
    const renderSlice = worker.slice.bind(worker);
    const ticks = s.ticks;
    if (!ticks.length) {
      editor.setStatus('nothingToExportNoMarkers', true);
      return;
    }
    const version = generation();
    const base = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: source.sampleRate };
    const fadeoutMs = s.doc.fadeoutMs;
    const noisegateDb = s.noisegateEnabled ? s.doc.noisegateDb : 0;
    const baseName = s.baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'slice';
    let skipped = 0;
    function assertCurrent(): void {
      if (generation() !== version) throw new DOMException('Export cancelled', 'AbortError');
    }
    async function fileAt(index: number): Promise<OutputFile | null> {
      assertCurrent();
      const start = tickToSampleExport(ticks[index], base);
      if (start > sourceLength) {
        skipped++;
        return null;
      }
      const end =
        index + 1 < ticks.length ? tickToSampleExport(ticks[index + 1], base) : sourceLength;
      const bytes = await renderSlice({ start, end, fadeoutMs, noisegateDb });
      assertCurrent();
      return { name: `${baseName}_${String(index).padStart(3, '0')}.wav`, bytes };
    }
    editor.exportLock = true;
    editor.setStatus('exportingSlices', { count: single ? 1 : ticks.length });
    try {
      if (single) {
        let index = ticks.findIndex((t) => t >= s.cursorTick);
        if (index < 0) index = ticks.length - 1;
        const file = await fileAt(index);
        if (file && (await platform.saveFile('wav', file.name, file.bytes))) {
          assertCurrent();
          editor.setStatus('exportedSingle', { file: file.name });
        }
      } else {
        async function* files(): AsyncGenerator<OutputFile> {
          for (let i = 0; i < ticks.length; i++) {
            const file = await fileAt(i);
            if (file) yield file;
          }
        }
        const count = await platform.exportFiles(files(), `${baseName}.zip`);
        assertCurrent();
        if (count !== null)
          editor.setStatus([
            { key: 'exportedSlicesTo', params: { count, directory: baseName } },
            ...(skipped
              ? [{ key: 'exportSkippedBeyond' as const, params: { count: skipped } }]
              : []),
          ]);
      }
    } catch (error) {
      if (generation() === version)
        editor.setStatus(
          'exportFailed',
          { message: error instanceof Error ? error.message : String(error) },
          true,
        );
    } finally {
      if (generation() === version) editor.exportLock = false;
    }
  }
  return { exportAll: () => run(false), exportSlice: () => run(true) };
}
