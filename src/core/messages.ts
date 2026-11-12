/**
 * Translation lookups, shared by the renderer chrome and tests.
 *
 * All string data lives in src/i18n/<language>.json (one file per language;
 * src/i18n/languages.json declares the language set), re-exported with
 * literal types by src/i18n/generated.ts (see scripts/gen-i18n.js). Every
 * section is keyed by a stable camelCase id — the same key set in the same
 * order in every language, asserted by tests/i18n.test.ts and by gen-i18n.js
 * at build time. This module types the keys and formats the templates; there
 * is no DOM here: renderer/i18n.ts owns the document walking, the persistence
 * and the current-language state.
 */

import { DATA } from '../i18n/generated.js';
import type { Language } from './language.js';

/** Static chrome strings (labels, buttons, titles), keyed by stable id. */
export type ChromeKey = keyof typeof DATA.en.chrome;

/** Status-bar message templates, keyed by stable id. */
export type StatusKey = keyof typeof DATA.en.status;

/** Values for {name} placeholders in status/scope templates. */
export type FormatParams = Record<string, string | number>;

/**
 * Translates one chrome key into the given language. English is the fallback
 * language: a missing entry in the target language resolves through English
 * before giving up with the key itself. {name} placeholders in the entry are
 * filled from params when given.
 */
export function translateText(lang: Language, key: ChromeKey, params?: FormatParams): string {
  const template = DATA[lang].chrome[key] ?? DATA.en.chrome[key] ?? key;
  return formatTemplate(template, params);
}

/** Fills {name} placeholders; unknown names are left intact so gaps are visible. */
function formatTemplate(template: string, params?: FormatParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Formats one status template in the given language (English placeholders). */
export function formatStatus(lang: Language, key: StatusKey, params?: FormatParams): string {
  const template = DATA[lang].status[key] ?? DATA.en.status[key] ?? key;
  return formatTemplate(template, params);
}

/** Band-detect scope line for the "selection" variant (numbers + range). */
export function scopeRangeText(lang: Language, m0: string, m1: string, seconds: string): string {
  return formatTemplate(DATA[lang].scopeRange, { m0, m1, seconds });
}
