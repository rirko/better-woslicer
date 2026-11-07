/**
 * Volume slider mapping: slider positions (0..100) map onto a -60..0 dB fader
 * range, and the transport works in amplitude 0..1. The dB scale is the
 * standard DAW fader feel — equal slider travel is equal perceived loudness
 * change, and the status bar reads directly in dB.
 *
 * Defaults (product decision): monitor -10 dB, cue -6 dB.
 */

export const VOLUME_SLIDER_RANGE_DB = 60;

export const DEFAULT_PLAYBACK_DB = -10;
export const DEFAULT_CUE_DB = -6;

export function dbToAmp(db: number): number {
  return Math.pow(10, db / 20);
}

export function ampToDb(amp: number): number {
  return amp <= 0 ? -Infinity : 20 * Math.log10(amp);
}

/** Slider position (0..100) -> dB in [-60, 0]. */
export function sliderToDb(position: number): number {
  const clamped = Math.max(0, Math.min(100, position));
  return -VOLUME_SLIDER_RANGE_DB + (clamped / 100) * VOLUME_SLIDER_RANGE_DB;
}

/** dB in [-60, 0] -> slider position (0..100). */
export function dbToSlider(db: number): number {
  const clamped = Math.max(-VOLUME_SLIDER_RANGE_DB, Math.min(0, db));
  return ((clamped + VOLUME_SLIDER_RANGE_DB) / VOLUME_SLIDER_RANGE_DB) * 100;
}
