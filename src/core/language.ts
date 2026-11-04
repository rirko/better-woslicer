/**
 * UI languages, shared by the renderer (static chrome + status bar) and the
 * native application menu built in the main process.
 *
 * It lives in core/ so neither side imports the other: the renderer must never
 * pull in Electron modules, and the main process must never import the
 * DOM-facing renderer i18n module.
 */

export type Language = "en" | "zh" | "ja" | "ko";

/** Every shipped language, in selector order. */
export const LANGUAGES: readonly Language[] = ["en", "zh", "ja", "ko"];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Maps an OS/Electron locale ("zh-CN", "ja-JP", "ko-KR", "en-US", ...) to a UI
 * language, falling back to English. Used for the first menu paint, before the
 * renderer pushes its persisted choice over IPC.
 */
export function languageFromLocale(locale: string): Language {
  const tag = String(locale ?? "").toLowerCase();
  if (tag.startsWith("zh")) return "zh";
  if (tag.startsWith("ja")) return "ja";
  if (tag.startsWith("ko")) return "ko";
  return "en";
}
