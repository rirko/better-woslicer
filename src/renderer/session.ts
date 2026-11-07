/**
 * Session archive: the working state the app restores on the next launch —
 * the editable options, the active sidebar tab, the marker document (bpm,
 * shift, fade/gate, markers) and the last opened file. It lives in
 * localStorage, which the Electron profile (under %APPDATA%) and the browser
 * origin storage both provide; window geometry is archived separately by the
 * main process next to it.
 *
 * Everything read back is validated field by field: the archive is untrusted
 * input, and a corrupt entry is dropped rather than restored. Dropped files
 * are never archived — they have no path to reopen.
 */

import { MAX_TICKS } from "../core/timebase.js";
import type { MarkerDoc } from "../core/markers.js";
import type { ViewState } from "./store.js";

const STORAGE_KEY = "woslicer.session";
export const SAVE_DEBOUNCE_MS = 600;
const CUE_MODES = ["off", "cowbell", "triangle", "metronome"] as const;

/** The option fields the archive restores, with their expected value type. */
const OPTION_KEYS = [
  "volume",
  "cueVolume",
  "playbackRate",
  "followPlayhead",
  "cueMode",
  "noisegateEnabled",
  "grid",
  "snap",
  "baseName",
  "clipStartNumber",
  "useFfNumbering",
  "bandDetectBands",
  "bandThresholdDb",
  "bandMinGapUnits",
  "bandSnap",
  "tapOffsetMs",
] as const;
type OptionKey = (typeof OPTION_KEYS)[number];

export interface SessionSnapshot {
  options: Partial<Pick<ViewState, OptionKey>>;
  doc: {
    bpm: number;
    shift: number;
    fadeoutMs: number;
    noisegateDb: number;
    markers: number[];
  } | null;
  tab: string | null;
  lastFile: { path: string; name: string } | null;
}

/** Extracts the archived working state from the live view state. */
export function captureSession(state: ViewState, activeTab: string | null): SessionSnapshot {
  const options: SessionSnapshot["options"] = {};
  for (const key of OPTION_KEYS) {
    (options as Record<string, unknown>)[key] = state[key];
  }
  const markers: number[] = [];
  const bitmap = state.doc.markers;
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (bitmap[tick] !== 0) markers.push(tick);
  }
  const path = state.source?.path ?? null;
  return {
    options,
    doc: {
      bpm: state.doc.bpm,
      shift: state.doc.shift,
      fadeoutMs: state.doc.fadeoutMs,
      noisegateDb: state.doc.noisegateDb,
      markers,
    },
    tab: activeTab,
    lastFile: path !== null && !path.startsWith("dropped:") ? { path, name: state.source?.name ?? "" } : null,
  };
}

function validOption(defaults: ViewState, key: OptionKey, value: unknown): boolean {
  if (key === "cueMode") return typeof value === "string" && (CUE_MODES as readonly string[]).includes(value);
  if (key === "bandDetectBands") {
    if (typeof value !== "object" || value === null) return false;
    const bands = value as Record<string, unknown>;
    return typeof bands.low === "boolean" && typeof bands.mid === "boolean" && typeof bands.high === "boolean";
  }
  switch (typeof defaults[key]) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string" && value.length <= 120;
    default:
      return false;
  }
}

/**
 * Reads the archived session, dropping every field that fails validation.
 * Returns null when nothing usable is stored.
 */
export function readSession(defaults: ViewState): SessionSnapshot | null {
  let raw: unknown;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch {
    return null; // Missing or corrupt archive: start fresh
  }
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;

  const options: SessionSnapshot["options"] = {};
  if (typeof s.options === "object" && s.options !== null) {
    const stored = s.options as Record<string, unknown>;
    for (const key of OPTION_KEYS) {
      const value = stored[key];
      if (validOption(defaults, key, value)) {
        (options as Record<string, unknown>)[key] = value;
      }
    }
  }

  let doc: SessionSnapshot["doc"] = null;
  if (typeof s.doc === "object" && s.doc !== null) {
    const d = s.doc as Record<string, unknown>;
    const nums = [d.bpm, d.shift, d.fadeoutMs, d.noisegateDb];
    if (nums.every((n) => typeof n === "number" && Number.isFinite(n)) && Array.isArray(d.markers)) {
      const ticks = d.markers.filter(
        (t): t is number => typeof t === "number" && Number.isInteger(t) && t >= 0 && t < MAX_TICKS
      );
      const unique = Array.from(new Set(ticks));
      if (unique.length <= 10000) {
        doc = {
          bpm: d.bpm as number,
          shift: d.shift as number,
          fadeoutMs: d.fadeoutMs as number,
          noisegateDb: d.noisegateDb as number,
          markers: unique,
        };
      }
    }
  }

  let tab: string | null = null;
  if (typeof s.tab === "string" && /^[a-z]{1,16}$/.test(s.tab)) tab = s.tab;

  let lastFile: SessionSnapshot["lastFile"] = null;
  if (typeof s.lastFile === "object" && s.lastFile !== null) {
    const f = s.lastFile as Record<string, unknown>;
    if (
      typeof f.path === "string" && f.path.length > 0 && f.path.length < 4096 && !f.path.startsWith("dropped:") &&
      typeof f.name === "string"
    ) {
      lastFile = { path: f.path, name: f.name };
    }
  }

  if (Object.keys(options).length === 0 && doc === null && tab === null && lastFile === null) return null;
  return { options, doc, tab, lastFile };
}

let suppressed = false;

/**
 * Stops archiving until the next launch: the Close action wipes the archive
 * and reloads, and the pre-clear state must not be re-archived on the way
 * out (debounce tail, beforeunload flush).
 */
export function suppressSessionSave(): void {
  suppressed = true;
}

export function writeSession(snapshot: SessionSnapshot): void {
  if (suppressed) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Unavailable storage loses the archive; the session keeps running.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear without storage.
  }
}
