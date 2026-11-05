/**
 * Native application menu and dialog strings, translated per UI language.
 *
 * Pure by design: the string data lives in src/i18n/<language>.json
 * (re-exported by src/i18n/generated.ts); this module types it and builds
 * the menu template. It takes the language plus the two things the menu has
 * to do (forward a command id to the renderer, open the About box) and
 * returns a plain template. main.ts owns the Electron objects and calls
 * Menu.buildFromTemplate, so this module stays unit-testable without
 * Electron.
 */

import type { MenuItemConstructorOptions } from "electron";
import { LANGUAGES, type Language } from "../core/language.js";
import { DATA } from "../i18n/generated.js";

export interface MenuStrings {
  file: string;
  openAudio: string;
  openWos: string;
  saveWos: string;
  exportSlice: string;
  exportAll: string;
  exit: string;
  edit: string;
  undo: string;
  redo: string;
  copySelection: string;
  cutSelection: string;
  pasteSelection: string;
  quantizeSelection: string;
  copyMeasure: string;
  cutMeasure: string;
  pasteMeasure: string;
  clearMarkers: string;
  view: string;
  zoomIn: string;
  zoomOut: string;
  help: string;
  about: string;
  aboutDetail: string;
}

/**
 * Builds a per-language record by picking one entry per declared language.
 * LANGUAGES and the DATA keys both derive from the i18n manifest, so the
 * mapping is complete by construction; the assertion only restates that.
 */
function perLanguage<T>(pick: (lang: Language) => T): Record<Language, T> {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, pick(lang)])) as Record<Language, T>;
}

/** Menu labels keyed by language, from the i18n data files. */
export const MENU_STRINGS: Record<Language, MenuStrings> = perLanguage((lang) => DATA[lang].menu);

/** Titles of the file dialogs the main process opens, plus filter labels. */
export interface DialogStrings {
  loadAudio: string;
  loadWos: string;
  saveWos: string;
  exportSlice: string;
  chooseExportFolder: string;
  filterWave: string;
  filterWos: string;
}

/** File-dialog titles keyed by language, from the i18n data files. */
export const DIALOG_STRINGS: Record<Language, DialogStrings> = perLanguage((lang) => DATA[lang].dialogs);

export interface MenuHandlers {
  /** Forwards a menu command id to the renderer. */
  send(action: string): void;
  /** Opens the localized About box. */
  showAbout(): void;
}

/** Builds the localized application menu template. */
export function menuTemplate(lang: Language, handlers: MenuHandlers): MenuItemConstructorOptions[] {
  const t = MENU_STRINGS[lang];
  return [
    {
      label: t.file,
      submenu: [
        { label: t.openAudio, accelerator: "CmdOrCtrl+O", click: () => handlers.send("open-audio") },
        { label: t.openWos, accelerator: "CmdOrCtrl+Shift+O", click: () => handlers.send("open-wos") },
        { label: t.saveWos, accelerator: "CmdOrCtrl+S", click: () => handlers.send("save-wos") },
        { type: "separator" },
        { label: t.exportSlice, accelerator: "CmdOrCtrl+E", click: () => handlers.send("export-slice") },
        { label: t.exportAll, accelerator: "CmdOrCtrl+Shift+E", click: () => handlers.send("export-all") },
        { type: "separator" },
        { label: t.exit, role: "quit" },
      ],
    },
    {
      label: t.edit,
      submenu: [
        { label: t.undo, accelerator: "CmdOrCtrl+Z", click: () => handlers.send("undo") },
        { label: t.redo, accelerator: "CmdOrCtrl+Shift+Z", click: () => handlers.send("redo") },
        { type: "separator" },
        { label: t.copySelection, accelerator: "CmdOrCtrl+C", click: () => handlers.send("copy-selection") },
        { label: t.cutSelection, accelerator: "CmdOrCtrl+X", click: () => handlers.send("cut-selection") },
        { label: t.pasteSelection, accelerator: "CmdOrCtrl+V", click: () => handlers.send("paste-selection") },
        { label: t.quantizeSelection, click: () => handlers.send("quantize") },
        { type: "separator" },
        // Legacy compatibility aliases (original woslicerIII measure model).
        { label: t.copyMeasure, click: () => handlers.send("measure-copy") },
        { label: t.cutMeasure, click: () => handlers.send("measure-cut") },
        { label: t.pasteMeasure, click: () => handlers.send("measure-paste") },
        { type: "separator" },
        { label: t.clearMarkers, click: () => handlers.send("clear-markers") },
      ],
    },
    {
      label: t.view,
      submenu: [
        { label: t.zoomIn, accelerator: "CmdOrCtrl+=", click: () => handlers.send("zoom-in") },
        { label: t.zoomOut, accelerator: "CmdOrCtrl+-", click: () => handlers.send("zoom-out") },
      ],
    },
    {
      label: t.help,
      submenu: [{ label: t.about, click: () => handlers.showAbout() }],
    },
  ];
}
