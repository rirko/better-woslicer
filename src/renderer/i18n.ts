/**
 * Renderer i18n: current language, DOM application and persistence.
 *
 * All translation data and the pure lookups live in core/messages.ts; this
 * module owns the document walking (text nodes + titles), the localStorage
 * choice and the current language. The choice is also pushed to the main
 * process so the native menu follows it (see app.ts / main.ts).
 */

import { LANGUAGES, type Language, isLanguage } from "../core/language.js";
import { KNOWN_KEYS, scopeRangeText, translateStatusFor, translateText } from "../core/messages.js";

export { LANGUAGES };
export type { Language };

const STORAGE_KEY = "woslicer.language";

let current: Language = "en";

/** BCP-47 tag for the root element, per UI language. */
const DOC_LANG: Record<Language, string> = { en: "en", zh: "zh-CN", ja: "ja", ko: "ko" };

/**
 * English source text per translated text node. Remembering the source instead
 * of reverse-mapping the translation makes switching any-language-to-any-
 * language lossless, and keeps duplicated translations harmless.
 */
const SOURCES = new WeakMap<Text, string>();

/** Attribute holding an element's original English title. */
const TITLE_SOURCE_ATTR = "data-i18n-title";

/** The text selectors whose child text nodes this module owns. */
const TEXT_SELECTORS = [
  "button",
  "label",
  "option",
  "summary",
  "h2",
  ".side-tab",
  ".hint",
  ".empty-title",
  ".empty-sub",
  ".beats-note",
  ".band-field span",
  ".calibration-progress span",
  ".kv > span",
  "span.bands-label",
].join(",");

/** Translates one English string into the active language (English is identity). */
export function tr(text: string): string {
  return translateText(current, text);
}

function translateTextNode(node: Text): void {
  const rawText = node.nodeValue ?? "";
  const trimmed = rawText.trim();
  if (!trimmed) return;
  let source = SOURCES.get(node);
  if (source === undefined) {
    // Only claim nodes that are known English chrome: app code writes dynamic
    // text into some of these nodes at runtime.
    if (!KNOWN_KEYS.has(trimmed)) return;
    source = trimmed;
    SOURCES.set(node, source);
  }
  const translated = translateText(current, source);
  if (translated === trimmed) return;
  const start = rawText.indexOf(trimmed);
  node.nodeValue = rawText.slice(0, start) + translated + rawText.slice(start + trimmed.length);
}

/** Applies the current language to the visible chrome. */
export function applyStaticTranslations(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = DOC_LANG[current];
  for (const el of document.querySelectorAll<HTMLElement>(TEXT_SELECTORS)) {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
    }
  }
  const titleSelector = "[title], [" + TITLE_SOURCE_ATTR + "]";
  for (const el of document.querySelectorAll<HTMLElement>(titleSelector)) {
    const saved = el.getAttribute(TITLE_SOURCE_ATTR);
    const source = saved ?? el.getAttribute("title") ?? "";
    if (saved === null) {
      if (!KNOWN_KEYS.has(source)) continue;
      el.setAttribute(TITLE_SOURCE_ATTR, source);
    }
    el.setAttribute("title", translateText(current, source));
  }
}

/** Band-detect scope line, "whole track" variant. */
export function bandScopeWhole(): string {
  return tr("Scope: whole track (no range selection)");
}

/** Band-detect scope line, "selection" variant. */
export function bandScopeRange(m0: string, m1: string, seconds: string): string {
  return scopeRangeText(current, m0, m1, seconds);
}

/** Pattern translator for the status bar. */
export function translateStatus(text: string): string {
  return translateStatusFor(current, text);
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
