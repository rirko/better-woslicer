import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, type Language } from "../src/core/language.js";
import { MENU_STRINGS, menuTemplate } from "../src/main/menu-i18n.js";

type Clickable = { label?: string; click?: () => void; submenu?: Clickable[] };

test("every language has a complete menu string set", () => {
  const reference = Object.keys(MENU_STRINGS.en).sort();
  assert.ok(reference.length >= 20, "menu strings look short");
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(MENU_STRINGS[lang]).sort(), reference, `menu string drift in ${lang}`);
    for (const [key, value] of Object.entries(MENU_STRINGS[lang])) {
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
    }
  }
});

test("the top-level menu bar is localized", () => {
  const handlers = { send: () => undefined, showAbout: () => undefined };
  const topLabels = (lang: Language): (string | undefined)[] =>
    menuTemplate(lang, handlers).map((item) => item.label);
  assert.deepEqual(topLabels("en"), ["File", "Edit", "View", "Help"]);
  assert.deepEqual(topLabels("zh"), ["文件", "编辑", "视图", "帮助"]);
  assert.deepEqual(topLabels("ja"), ["ファイル", "編集", "表示", "ヘルプ"]);
  assert.deepEqual(topLabels("ko"), ["파일", "편집", "보기", "도움말"]);
});

test("every language emits the same command ids in the same order", () => {
  const collect = (lang: Language): string[] => {
    const ids: string[] = [];
    const template = menuTemplate(lang, {
      send: (action) => ids.push(action),
      showAbout: () => ids.push("about"),
    }) as Clickable[];
    for (const top of template) {
      for (const item of top.submenu ?? []) item.click?.();
    }
    return ids;
  };
  const expected = [
    "open-audio",
    "open-wos",
    "save-wos",
    "export-slice",
    "export-all",
    "undo",
    "redo",
    "copy-selection",
    "cut-selection",
    "paste-selection",
    "quantize",
    "measure-copy",
    "measure-cut",
    "measure-paste",
    "clear-markers",
    "zoom-in",
    "zoom-out",
    "about",
  ];
  for (const lang of LANGUAGES) {
    assert.deepEqual(collect(lang), expected, `command drift in ${lang}`);
  }
});

test("accelerators are preserved in every language", () => {
  const accel = (lang: Language): (string | undefined)[] => {
    const template = menuTemplate(lang, { send: () => undefined, showAbout: () => undefined }) as Clickable[];
    const file = template[0].submenu ?? [];
    return file.map((item) => (item as { accelerator?: string }).accelerator).filter(Boolean);
  };
  const en = accel("en");
  assert.deepEqual(en, ["CmdOrCtrl+O", "CmdOrCtrl+Shift+O", "CmdOrCtrl+S", "CmdOrCtrl+E", "CmdOrCtrl+Shift+E"]);
  for (const lang of LANGUAGES) assert.deepEqual(accel(lang), en, `accelerator drift in ${lang}`);
});
