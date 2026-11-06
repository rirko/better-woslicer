/**
 * Slice export pipeline shared by the Electron main process (which writes the
 * files to disk) and the browser host (which packs them into a ZIP): sorts the
 * marker ticks, checks the timeline bounds, renders every slice with the exact
 * export DSP and encodes it as a canonical 16-bit WAV file.
 */

import { renderSlice, type SourceAudio } from "./slicer.js";
import { encodeWav16 } from "./wav.js";
import { tickToSampleExport, type TimeBase } from "./timebase.js";

export interface SliceFileRequest {
  baseName: string;
  bpm: number;
  shift: number;
  fadeoutMs: number;
  noisegateDb: number;
  markers: number[];
}

export interface SliceFile {
  name: string;
  data: Uint8Array;
}

/** Renders every requested slice into an in-memory WAV file. */
export function renderSliceFiles(source: SourceAudio, request: SliceFileRequest): SliceFile[] {
  const base: TimeBase = { bpm: request.bpm, shift: request.shift, sampleRate: source.sampleRate };
  const sorted = [...request.markers].sort((a, b) => a - b);
  const files: SliceFile[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const startSample = tickToSampleExport(sorted[i], base);
    if (startSample > source.length) {
      // Original DoPrev: "元waveファイルの参照外です。" (start out of range).
      throw new Error(
        `slice ${i} (tick ${sorted[i]}) starts at sample ${startSample}, beyond the end of the source (${source.length} frames)`
      );
    }
    const endSample = i + 1 < sorted.length ? tickToSampleExport(sorted[i + 1], base) : source.length;
    const rendered = renderSlice(source, {
      start: startSample,
      end: endSample,
      fadeoutMs: request.fadeoutMs,
      noisegateDb: request.noisegateDb,
    });
    files.push({
      name: `${request.baseName}_${String(i).padStart(3, "0")}.wav`,
      data: encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length),
    });
  }
  return files;
}
