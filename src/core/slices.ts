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

export interface SliceExport {
  files: SliceFile[];
  /** Cut marks beyond the end of the source: illegal, skipped (counted). */
  skipped: number;
}

/**
 * Renders every requested slice into an in-memory WAV file. Cut marks beyond
 * the end of the source are illegal (a confirmed defect of the original
 * tool) and are skipped; a cut exactly at the end of the source is legal and
 * renders a zero-duration WAV, keeping the cut-to-file numbering 1:1.
 */
export function renderSliceFiles(source: SourceAudio, request: SliceFileRequest): SliceExport {
  const base: TimeBase = { bpm: request.bpm, shift: request.shift, sampleRate: source.sampleRate };
  const sorted = [...request.markers].sort((a, b) => a - b);
  const files: SliceFile[] = [];
  let skipped = 0;
  for (let i = 0; i < sorted.length; i++) {
    const startSample = tickToSampleExport(sorted[i], base);
    if (startSample > source.length) {
      skipped += 1;
      continue;
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
  return { files, skipped };
}
