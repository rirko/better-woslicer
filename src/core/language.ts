/** Language metadata and preference matching shared by UI and tests. */
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

/** Picks the first shipped language in the user's ordered locale preferences. */
export function detectLanguage(locales: readonly string[]): Language {
  for (const locale of locales ?? []) {
    const tag = String(locale ?? '').toLowerCase();
    for (const lang of LANGUAGES) {
      if (tag === lang || tag.startsWith(lang + '-')) return lang;
    }
  }
  return 'en';
}
