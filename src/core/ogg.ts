/**
 * OGG Vorbis loading.
 *
 * The original delegated to OggVorbis.dll (native). Here OGG files are
 * decoded with a pure WASM decoder (@wasm-audio-decoders/ogg-vorbis) and
 * converted to the internal int16 representation, so the rest of the
 * pipeline is identical for WAV and OGG sources. The decoder import is
 * dynamic: if the package is missing the error is reported to the user
 * instead of crashing the app.
 */

import { DecodedWav } from './wav.js';

interface VorbisDecodeResult {
  channelData: Float32Array[];
  sampleRate: number;
}

interface DecoderFactory {
  new (): {
    ready: Promise<void>;
    decode(uint8Array: Uint8Array): Promise<VorbisDecodeResult>;
    free?: () => void;
  };
}

/** Converts float PCM [-1, 1) to the internal int16 scale (round, clamp). */
function floatToInternal(x: number): number {
  let v = Math.round(x * 32768);
  if (v < -32768) v = -32768;
  if (v > 32767) v = 32767;
  return v;
}

/** Decodes an OGG Vorbis file buffer into the shared DecodedWav shape. */
export async function decodeOgg(buffer: Uint8Array): Promise<DecodedWav> {
  let factory: DecoderFactory;
  try {
    // Dynamic import keeps the dependency optional at runtime.
    const mod = await import('@wasm-audio-decoders/ogg-vorbis');
    factory = (mod as { OggVorbisDecoder: DecoderFactory }).OggVorbisDecoder;
  } catch (cause) {
    throw new Error(
      'OGG support requires the @wasm-audio-decoders/ogg-vorbis package ' +
        '(run npm install). Original error: ' +
        (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    );
  }

  const decoder = new factory();
  await decoder.ready;
  let result: VorbisDecodeResult;
  try {
    result = await decoder.decode(buffer);
  } finally {
    decoder.free?.();
  }

  const channels = result.channelData.length;
  if (channels < 1 || channels > 2) {
    throw new Error(`unsupported OGG channel count ${channels}`);
  }
  const length = result.channelData[0].length;
  const data: Int16Array[] = result.channelData.map((ch) => {
    const out = new Int16Array(length);
    for (let i = 0; i < length; i++) out[i] = floatToInternal(ch[i]);
    return out;
  });
  return { sampleRate: result.sampleRate, channels, length, data, wasFloat: false };
}
