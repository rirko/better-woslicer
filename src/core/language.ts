/**
 * UI languages, shared by the renderer (static chrome + status bar) and the
 * native application menu built in the main process.
 *
 * The language list and its metadata live in src/i18n/languages.json — the
 * single source of truth shared by the app, the tests and the packager (which
 * prunes the bundled Chromium locale .pak files to exactly these locales).
 * scripts/gen-i18n.js re-exports it as src/i18n/generated.ts with literal
 * types, so the Language union below is derived from that data. This module
 * keeps the behavior: validation and OS-locale matching. It lives in core/ so
 * neither side imports the other: pure UI code must stay free of host APIs
 * modules, and the main process must never import the DOM-facing renderer
 * i18n module.
 */

import { MANIFEST } from '../i18n/generated.js';

/** Every shipped language, as declared by the i18n manifest. */
export type Language = (typeof MANIFEST.languages)[number]['id'];

/** Every shipped language, in selector order. */
export const LANGUAGES: readonly Language[] = MANIFEST.languages.map((entry) => entry.id);

/**
 * Completes a per-language record built from manifest data. The manifest is
 * generated data, so completeness cannot be expressed in the type system
 * alone; this validates it at module load instead of shipping undefined.
 */
function completeRecord(source: Partial<Record<Language, string>>): Record<Language, string> {
  for (const language of LANGUAGES) {
    if (typeof source[language] !== 'string') {
      throw new Error(`i18n manifest is missing metadata for ${language}`);
    }
  }
  return source as Record<Language, string>;
}

/** Selector label per language (the language's own name). */
export const LANGUAGE_LABELS: Record<Language, string> = completeRecord(
  Object.fromEntries(
    MANIFEST.languages.map((entry): [Language, string] => [entry.id, entry.label]),
  ),
);

/** BCP-47 tag for the root element, per UI language. */
export const DOC_LANG: Record<Language, string> = completeRecord(
  Object.fromEntries(
    MANIFEST.languages.map((entry): [Language, string] => [entry.id, entry.docLang]),
  ),
);

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Maps an OS locale ("zh-CN", "ja-JP", "ko-KR", "en-US", ...) to a UI
 * language: the locale tag matches its language id exactly or as a BCP-47
 * prefix ("zh" -> "zh-CN"), in manifest order; anything else falls back to
 * English (declared in the manifest — gen-i18n enforces its presence). Used
 * for the first menu paint, before the renderer pushes its persisted choice
 * over IPC. Generic on purpose: a new language needs no change here.
 */
export function languageFromLocale(locale: string): Language {
  const tag = String(locale ?? '').toLowerCase();
  for (const lang of LANGUAGES) {
    if (tag === lang || tag.startsWith(lang + '-')) return lang;
  }
  return 'en';
}

/**
 * Picks the UI language from an ordered list of user locales (host-provided:
 * navigator.language mirrors the system display language; the browser: the
 * same preference that produces the Accept-Language header). The first
 * locale that resolves to a shipped language wins — unlike
 * languageFromLocale there is no per-locale fallback, so a later locale can
 * still match after an earlier unmatched one.
 */
export function detectLanguage(locales: readonly string[]): Language {
  for (const locale of locales ?? []) {
    const tag = String(locale ?? '').toLowerCase();
    for (const lang of LANGUAGES) {
      if (tag === lang || tag.startsWith(lang + '-')) return lang;
    }
  }
  return 'en';
}
