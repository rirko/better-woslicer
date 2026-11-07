import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST as manifest, DATA as GENERATED_DATA, EN as en } from "../src/i18n/generated.js";
import { LANGUAGES, DOC_LANG, detectLanguage, isLanguage, languageFromLocale, type Language } from "../src/core/language.js";
import { DIALOG_STRINGS, MENU_STRINGS } from "../src/main/menu-i18n.js";
import {
  formatStatus,
  scopeRangeText,
  translateText,
  type ChromeKey,
  type StatusKey,
} from "../src/core/messages.js";

interface LanguageData {
  chrome: Record<string, string>;
  status: Record<string, string>;
  menu: Record<string, string>;
  dialogs: Record<string, string>;
  scopeRange: string;
}
const DATA: Record<Language, LanguageData> = GENERATED_DATA;
const nonEnglish = LANGUAGES.filter((lang) => lang !== "en");

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

test("the i18n manifest is the single source of truth for the language set", () => {
  assert.deepEqual(manifest.languages.map((entry) => entry.id), [...LANGUAGES]);
  const ids = manifest.languages.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate language id in manifest");
  const locales = manifest.languages.flatMap((entry) => entry.chromiumLocales);
  assert.equal(new Set(locales).size, locales.length, "a chromium locale backs two languages");
  for (const entry of manifest.languages) {
    assert.ok(entry.label.trim().length > 0, `empty selector label for ${entry.id}`);
    assert.ok(entry.docLang.trim().length > 0, `empty docLang for ${entry.id}`);
    assert.ok(entry.chromiumLocales.length > 0, `no chromium locales for ${entry.id}`);
    for (const locale of entry.chromiumLocales) {
      assert.match(locale, /^[a-z]{2,3}(-[A-Z][a-zA-Z]*)*$/, `malformed chromium locale ${locale}`);
    }
  }
});

test("docLang covers every language (drives <html lang> and the selector options)", () => {
  for (const lang of LANGUAGES) {
    assert.ok(DOC_LANG[lang].length > 0, `missing docLang for ${lang}`);
  }
});

test("every language ships the identical key set in every section", () => {
  const minimums = { chrome: 60, status: 60, menu: 20, dialogs: 5 } as const;
  for (const section of ["chrome", "status", "menu", "dialogs"] as const) {
    const reference = Object.keys(en[section]).sort();
    assert.ok(reference.length >= minimums[section], `${section} dictionary looks short: ${reference.length}`);
    for (const lang of nonEnglish) {
      assert.deepEqual(Object.keys(DATA[lang][section]).sort(), reference, `${section} drift in ${lang}`);
    }
  }
});

test("status templates keep their placeholder names across languages", () => {
  for (const key of Object.keys(en.status) as StatusKey[]) {
    const reference = placeholders(en.status[key]);
    for (const lang of nonEnglish) {
      assert.deepEqual(placeholders(DATA[lang].status[key]), reference, `${lang} status.${key} placeholders`);
    }
  }
});

test("English values are the reference copy of every user-facing string", () => {
  // en.json is the baseline the smoke tests and docs quote: it must not drift
  // from the shipped UI text without an explicit decision.
  assert.equal(translateText("en", "open"), "Open");
  assert.equal(translateText("en", "bandDetect"), "Band detect");
  assert.equal(formatStatus("en", "playing"), "Playing");
  assert.equal(formatStatus("en", "paintedMarkers", { count: 3 }), "Painted 3 marker(s)");
});

test("menu and dialog sections stay in lockstep across languages", () => {
  const menuKeys = Object.keys(MENU_STRINGS.en).sort();
  const dialogKeys = Object.keys(DIALOG_STRINGS.en).sort();
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(MENU_STRINGS[lang]).sort(), menuKeys, `menu drift in ${lang}`);
    assert.deepEqual(Object.keys(DIALOG_STRINGS[lang]).sort(), dialogKeys, `dialog drift in ${lang}`);
  }
});

test("no translation is empty", () => {
  for (const lang of nonEnglish) {
    for (const [section, data] of Object.entries(DATA[lang])) {
      if (section === "scopeRange") {
        assert.ok((data as string).trim().length > 0, `${lang}: empty scopeRange`);
        continue;
      }
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (typeof value === "string") {
          assert.ok(value.trim().length > 0, `${lang}: empty ${section}.${key}`);
        }
      }
    }
  }
});

test("status and scope placeholders are camelCase names", () => {
  for (const template of [en.scopeRange, ...Object.values(en.status)]) {
    for (const match of template.matchAll(/\{(\w+)\}/g)) {
      assert.match(match[1], /^[a-z][A-Za-z0-9]*$/, `placeholder {${match[1]}} is not camelCase`);
    }
  }
});

test("Japanese strings keep the original woslicerIII terminology", () => {
  // Regression anchors from the decompiled original (Form1/2/3.cs): these are
  // the words the original author chose, restored after AI translation drift.
  const anchors: { section: "chrome" | "menu" | "status"; key: string; term: string }[] = [
    { section: "chrome", key: "open", term: "読込" },
    { section: "chrome", key: "export", term: "出力" },
    { section: "chrome", key: "shiftLabel", term: "ずらし" },
    { section: "chrome", key: "gateCheckbox", term: "ノイズゲート" },
    { section: "chrome", key: "ffNumberingLabel", term: "FF定義" },
    { section: "chrome", key: "clipStartNoLabel", term: "出力番号" },
    { section: "chrome", key: "clearMarkers", term: "切断位置をクリア" },
    { section: "chrome", key: "bmseOut", term: "クリップボードへ出力" },
    { section: "chrome", key: "saveWos", term: ".wos を出力" },
    { section: "menu", key: "openAudio", term: "waveファイル読込" },
    { section: "menu", key: "saveWos", term: "wosファイル出力" },
    { section: "menu", key: "exportAll", term: "全スライスを出力" },
    { section: "menu", key: "clearMarkers", term: "切断位置のクリア" },
    { section: "status", key: "exportingSlices", term: "出力中" },
    { section: "status", key: "paintedMarkers", term: "切断位置を描画" },
    { section: "status", key: "breakPointAtTick", term: "切断位置を配置" },
    { section: "status", key: "bmseClipboardOut", term: "出力番号" },
    { section: "status", key: "bmseClipboardImported", term: "読み込みました" },
    { section: "status", key: "savedWos", term: "出力しました" },
  ];
  for (const { section, key, term } of anchors) {
    const actual = DATA.ja[section][key];
    assert.ok(
      typeof actual === "string" && actual.includes(term),
      `ja ${section}.${key} lost the original term "${term}" (got: ${String(actual)})`
    );
  }
  // The AI-translation drift must not come back either. 開く stays legitimate
  // when the BMHelper port opens a PROJECT file with the original's own
  // wording (プロジェクトを開く); only the audio-open drift is banned.
  for (const banned of ["マーカー", "書き出し", "開く"]) {
    const occurrences: string[] = [];
    for (const [section, data] of Object.entries(DATA.ja)) {
      if (section === "scopeRange") continue;
      for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
        const value = typeof raw === "string" ? raw.replace(/プロジェクトを開く/g, "") : null;
        if (value !== null && value.includes(banned)) occurrences.push(`${section}.${key}`);
      }
    }
    assert.deepEqual(occurrences, [], `ja still carries the drifted term "${banned}" in: ${occurrences.join(", ")}`);
  }
});

test("translateText resolves chrome keys with English as the fallback language", () => {
  assert.equal(translateText("zh", "open"), "打开");
  assert.equal(translateText("ja", "open"), "読込");
  assert.equal(translateText("ko", "open"), "열기");
  assert.equal(translateText("zh", "bandLow"), "低频");
  // fill {name} slots when given
  assert.equal(translateText("zh", "framesCount", { count: "1,234" }), "1,234 采样帧");
  assert.equal(translateText("en", "readoutTick", { measure: "001", tick: 24 }), "M001  tick 24");
});

test("formatStatus fills every placeholder and leaves unknown ones visible", () => {
  assert.equal(formatStatus("zh", "breakPointAtTick", { tick: 12 }), "已在 tick 12 打点");
  assert.equal(formatStatus("ja", "gridPerMeasure", { grid: 8 }), "グリッド：1 小節あたり 8");
  assert.equal(formatStatus("ko", "movedMarkersBy", { count: 4, delta: -8 }), "마커 4개를 -8 tick 이동");
  assert.equal(formatStatus("zh", "playing"), "播放中");
  assert.equal(formatStatus("en", "bandDetectCuts", { count: 5, bands: "Low/Mid/High", threshold: "6.0" }),
    "Band detect: +5 cuts (Low/Mid/High ≥ +6.0 dB)");
  // unknown placeholder names stay in the output so the gap is observable
  assert.equal(formatStatus("en", "movedMarkersBy", { count: 1 }), "Moved 1 marker(s) by {delta} ticks");
});

test("the band-detect scope line is localized", () => {
  assert.equal(
    scopeRangeText("en", "001", "003", "2.50"),
    "Scope: selection M001–M003 (2.50s) · only this range"
  );
  assert.ok(scopeRangeText("zh", "001", "003", "2.50").startsWith("范围：选区"));
  assert.ok(scopeRangeText("ja", "001", "003", "2.50").startsWith("範囲：選択"));
  assert.ok(scopeRangeText("ko", "001", "003", "2.50").startsWith("범위: 선택"));
});

test("every data-i18n reference in index.html resolves to a chrome key", () => {
  const html = readFileSync(join(__dirname, "..", "..", "src", "renderer", "index.html"), "utf8");
  const referenced = new Set<string>();
  for (const match of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) {
    referenced.add(match[1]);
  }
  assert.ok(referenced.size >= 60, `index.html carries few i18n references: ${referenced.size}`);
  const chromeKeys = new Set(Object.keys(en.chrome));
  const unknown = [...referenced].filter((key) => !chromeKeys.has(key));
  assert.deepEqual(unknown, [], "index.html references chrome keys that do not exist");
});

test("locale mapping picks the closest shipped language", () => {
  assert.equal(languageFromLocale("zh-CN"), "zh");
  assert.equal(languageFromLocale("zh-Hant-TW"), "zh");
  assert.equal(languageFromLocale("ja-JP"), "ja");
  assert.equal(languageFromLocale("ko-KR"), "ko");
  assert.equal(languageFromLocale("en-US"), "en");
  assert.equal(languageFromLocale("de-DE"), "en");
  assert.equal(languageFromLocale(""), "en");
  assert.equal(languageFromLocale(undefined as unknown as string), "en");
});

test("auto detection walks the preference list without per-locale fallback", () => {
  assert.equal(detectLanguage(["de-DE", "ja-JP", "ko"]), "ja");
  assert.equal(detectLanguage(["zh-TW", "en"]), "zh");
  assert.equal(detectLanguage(["fr-FR", "de-DE"]), "en");
  assert.equal(detectLanguage([]), "en");
  assert.equal(detectLanguage(["ko"]), "ko");
});

test("isLanguage gates the IPC payload", () => {
  assert.equal(isLanguage("ja"), true);
  assert.equal(isLanguage("ko"), true);
  assert.equal(isLanguage("zh"), true);
  assert.equal(isLanguage("fr"), false);
  assert.equal(isLanguage(null), false);
  assert.equal(isLanguage(7), false);
  assert.equal(isLanguage(""), false);
});

// Keep the chrome key type honest: a ChromeKey must be assignable from its
// literal and the reference set must not silently collapse to string.
const _typeProbe: ChromeKey = "open";
void _typeProbe;
