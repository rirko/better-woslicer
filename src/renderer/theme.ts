/**
 * Color themes: the single source of truth for every color the app draws.
 *
 * Each palette is a flat record of semantic tokens; the active one is pushed
 * both to CSS custom properties (styles.css consumes var(--…)) and to canvas
 * code through palette(), so no color literal exists outside this file.
 *
 * The dark palette is the original app look. The light palette inverts the
 * surface elevation (elevated surfaces read lighter, borders darker) and
 * darkens the signal colors for contrast on light backgrounds.
 *
 * Hue choices keep the main families (teal signals, amber accent, red danger)
 * apart under red-green color blindness: they differ in lightness as well as
 * hue, and the band overlay swaps its weak yellow-green for a bluish green,
 * which deuteranopia reads as a clearly separate blue-gray.
 */

export type ThemeName = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface Palette {
  app: string;
  panel: string;
  surface1: string;
  surface2: string;
  surface3: string;
  text1: string;
  text2: string;
  text3: string;
  accent: string;
  selection: string;
  playhead: string;
  cue: string;
  danger: string;
  /* Waveform: light min/max envelope, darker/lighter RMS band inside it. */
  wave: string;
  waveBright: string;
  waveRms: string;
  waveRmsBright: string;
  /* Low-alpha fills derived from the tokens above. */
  waveDim: string;
  waveBrightDim: string;
  waveRmsDim: string;
  waveRmsBrightDim: string;
  selectionFill: string;
  ghost: string;
  viewportFill: string;
  /* Band overlay (frozen hue roles: violet / green / pink). */
  bandLow: string;
  bandMid: string;
  bandHigh: string;
  /* No-audio region hatch. */
  hatch: string;
}

const DARK: Palette = {
  app: "#0e1013",
  panel: "#14171b",
  surface1: "#1a1e23",
  surface2: "#22272d",
  surface3: "#2b3138",
  text1: "#edeff2",
  text2: "#b7bec6",
  text3: "#8d97a1",
  accent: "#f2b24c",
  selection: "#7fb3ff",
  playhead: "#f5f7fa",
  cue: "#58c7e8",
  danger: "#ff6b6b",
  wave: "#5fa79d",
  waveBright: "#8fe3d6",
  waveRms: "#2e5450",
  waveRmsBright: "#456e68",
  waveDim: "rgba(95, 167, 157, 0.35)",
  waveBrightDim: "rgba(143, 227, 214, 0.35)",
  waveRmsDim: "rgba(46, 84, 80, 0.4)",
  waveRmsBrightDim: "rgba(69, 110, 104, 0.4)",
  selectionFill: "rgba(127, 179, 255, 0.12)",
  ghost: "rgba(143, 227, 214, 0.25)",
  viewportFill: "rgba(242, 178, 76, 0.18)",
  bandLow: "rgba(177, 140, 255, 0.85)",
  bandMid: "rgba(0, 191, 146, 0.75)",
  bandHigh: "rgba(240, 143, 180, 0.85)",
  hatch: "#39414c",
};

const LIGHT: Palette = {
  app: "#eceef1",
  panel: "#e2e5e9",
  surface1: "#f7f8fa",
  surface2: "#eef0f3",
  surface3: "#c9ced6",
  text1: "#1a1d21",
  text2: "#3e444c",
  text3: "#6b7480",
  accent: "#b07818",
  selection: "#2f6fdb",
  playhead: "#14171b",
  cue: "#0e86b0",
  danger: "#d94848",
  wave: "#2e7d74",
  waveBright: "#14655c",
  waveRms: "#b9d9d3",
  waveRmsBright: "#93c6be",
  waveDim: "rgba(46, 125, 116, 0.35)",
  waveBrightDim: "rgba(20, 101, 92, 0.35)",
  waveRmsDim: "rgba(185, 217, 211, 0.5)",
  waveRmsBrightDim: "rgba(147, 198, 190, 0.5)",
  selectionFill: "rgba(47, 111, 219, 0.1)",
  ghost: "rgba(20, 101, 92, 0.22)",
  viewportFill: "rgba(176, 120, 24, 0.18)",
  bandLow: "rgba(109, 64, 199, 0.85)",
  bandMid: "rgba(0, 131, 101, 0.8)",
  bandHigh: "rgba(178, 68, 122, 0.85)",
  hatch: "#b7bdc6",
};

/** CSS custom property names per palette token (styles.css consumes these). */
const CSS_VARS: Record<string, string> = {
  app: "--app",
  panel: "--panel",
  surface1: "--surface-1",
  surface2: "--surface-2",
  surface3: "--surface-3",
  text1: "--text-1",
  text2: "--text-2",
  text3: "--text-3",
  accent: "--accent",
  selection: "--selection",
  playhead: "--playhead",
  cue: "--cue",
  danger: "--danger",
  wave: "--wave",
  waveBright: "--wave-bright",
  bandLow: "--band-low",
  bandMid: "--band-mid",
  bandHigh: "--band-high",
};

let resolved: ResolvedTheme = "dark";

/** The palette canvas code draws with right now. */
export function palette(): Palette {
  return resolved === "light" ? LIGHT : DARK;
}

/** The theme currently painted with (the resolution of the chosen name). */
export function activeTheme(): ResolvedTheme {
  return resolved;
}

/** The system color scheme, or dark when the host cannot answer. */
function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Applies the chosen theme name ("system" follows prefers-color-scheme) by
 * painting the CSS custom properties on the root element. Canvas layers pick
 * the change up on their next draw; call the app's redraw after switching.
 */
export function applyTheme(name: ThemeName): void {
  resolved = name === "system" ? systemTheme() : name;
  const p = palette();
  const root = document.documentElement;
  root.dataset.theme = resolved;
  for (const [token, cssVar] of Object.entries(CSS_VARS)) {
    root.style.setProperty(cssVar, p[token as keyof Palette]);
  }
}

/**
 * Calls back whenever the system color scheme flips while running; the
 * callback must re-apply the theme when the selection is "system".
 */
export function watchSystemTheme(onChange: () => void): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (): void => onChange();
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
  } else if (typeof query.addListener === "function") {
    query.addListener(listener); // Legacy Safari/old Chromium engines
  }
}

const STORAGE_KEY = "woslicer.theme";

/** The persisted selection, or "system" when nothing (valid) is stored. */
export function themeSelection(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Unavailable storage behaves like the system choice
  }
  return "system";
}

/** Persists the selection (call together with applyTheme). */
export function setThemeName(name: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // The session still switches
  }
}
