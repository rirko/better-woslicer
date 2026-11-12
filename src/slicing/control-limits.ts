// Shared UI input ranges for the document fade and noisegate fields. These
// clamp what the on-screen number inputs accept; deeper validation stays in
// the document codec and is intentionally out of scope here.
export const FADE_INPUT_LIMITS = { min: 0, max: 60000 } as const;
export const GATE_INPUT_LIMITS = { min: -200, max: 0 } as const;
