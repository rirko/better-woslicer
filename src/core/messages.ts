/** Message types derived from the dictionaries; Vue I18n owns runtime formatting. */
import type { DATA } from '../i18n/generated.js';

/** Static chrome strings (labels, buttons, titles), keyed by stable id. */
export type ChromeKey = keyof typeof DATA.en.chrome;

/** Status-bar message templates, keyed by stable id. */
export type StatusKey = keyof typeof DATA.en.status;

/** Values for {name} placeholders in status/scope templates. */
export type FormatParams = Record<string, string | number>;
