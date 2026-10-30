/**
 * Numeric helpers replicating the exact arithmetic of the original woslicerIII
 * (.NET Win32 build), which mixes float32 and float64 operations.
 *
 * The original compiles to IL with explicit conv.r4 / conv.r8 boundaries.
 * Reproducing those roundings is required for byte-identical slice output.
 */

/** Rounds a number to the nearest float32 (IL `conv.r4`). */
export function f32(x: number): number {
  return Math.fround(x);
}

/**
 * IL `conv.i4` — cast a double to int32: truncates toward zero.
 * Values stay far inside int32 range in all supported code paths.
 */
export function toInt32(x: number): number {
  return Math.trunc(x);
}

/** C# integer division (truncating). Operands are assumed to be integers. */
export function intDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/**
 * The float32 constant baked into the original binaries for degrees->radians
 * conversion in the fade-in / sustain-tail envelope (IL ldc.r4 operand
 * 0.017453333362936974, i.e. (float)(PI / 180) rounded to a coarser float).
 */
export const DEG_TO_RAD_F32 = Math.fround(0.017453333362936974);

/**
 * The float64 constant used by the original Cut() gate envelope
 * (IL ldc.r8 operand 0.017453332742055256).
 */
export const DEG_TO_RAD_F64 = 0.017453332742055256;
