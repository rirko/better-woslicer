/**
 * Renderer i18n: current language, DOM application and persistence.
 *
 * All translation data and the pure lookups live in core/messages.ts; this
 * module owns the DOM application (elements carry data-i18n / data-i18n-title
 * attributes holding stable chrome keys), the localStorage choice and the
 * current language. The choice is also pushed to the main process so the
 * native menu follows it (see app.ts / main.ts).
 */

import { LANGUAGES, DOC_LANG, LANGUAGE_LABELS, type Language, isLanguage } from "../core/language.js";
import {
  formatStatus,
  scopeRangeText,
  translateText,
  type ChromeKey,
  type FormatParams,
  type StatusKey,
} from "../core/messages.js";
import type { StatusEntry } from "./store.js";

export { LANGUAGES, DOC_LANG, LANGUAGE_LABELS };
export type { Language };

const STORAGE_KEY = "woslicer.language";

let current: Language = "en";

/** Translates one chrome key into the active language (fills {name} slots). */
export function tr(key: ChromeKey, params?: FormatParams): string {
  return translateText(current, key, params);
}

/** Formats one status entry in the active language (segments joined " · "). */
export function renderStatus(entry: StatusEntry): string {
  return entry.segments.map((s) => formatStatus(current, s.key, s.params)).join(" · ");
}

/** Applies the current language to every element tagged with i18n attributes. */
export function applyStaticTranslations(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = DOC_LANG[current];
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n as ChromeKey;
    el.textContent = translateText(current, key);
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const key = el.dataset.i18nTitle as ChromeKey;
    el.setAttribute("title", translateText(current, key));
  }
}

/** Band-detect scope line, "whole track" variant. */
export function bandScopeWhole(): string {
  return tr("bandScopeWhole");
}

/** Band-detect scope line, "selection" variant. */
export function bandScopeRange(m0: string, m1: string, seconds: string): string {
  return scopeRangeText(current, m0, m1, seconds);
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage may be unavailable; the session still switches
  }
  applyStaticTranslations();
}

/** Call once at boot (before DOM wiring) to restore the saved language. */
export function initLanguage(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  current = isLanguage(saved) ? saved : "en";
}

/** Re-exported for callers formatting status entries with an explicit language. */
export { formatStatus };
export type { StatusKey };
