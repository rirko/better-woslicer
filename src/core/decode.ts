/**
 * Audio decode dispatch shared by the Electron main process and the browser
 * host: picks WAV or OGG parsing by file extension (only the extension is
 * trusted), mirroring the original tool's behaviour of trying the WAV parser
 * first and rejecting unsupported names afterwards.
 */

import { parseWav, type DecodedWav } from "./wav.js";
import { decodeOgg } from "./ogg.js";

/** Decodes the bytes of an audio file named `name` (.wav or .ogg). */
export async function decodeAudio(name: string, bytes: Uint8Array): Promise<DecodedWav> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".ogg")) return decodeOgg(bytes);
  // The WAV parser reads a plain ArrayBuffer; the byteOffset/length slice
  // copies the payload into one, mirroring the shape parseWav expects.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const decoded = parseWav(buffer);
  if (!lower.endsWith(".wav")) throw new Error(`unsupported audio file: ${name}`);
  return decoded;
}
