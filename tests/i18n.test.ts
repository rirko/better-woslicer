import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, isLanguage, languageFromLocale } from "../src/core/language.js";
import {
  DICTS,
  KNOWN_KEYS,
  scopeRangeText,
  translateStatusFor,
  translateText,
} from "../src/core/messages.js";

test("every language ships the identical chrome key set", () => {
  const reference = [...KNOWN_KEYS].sort();
  assert.ok(reference.length >= 80, `dictionary looks short: ${reference.length}`);
  assert.deepEqual(Object.keys(DICTS.en), [], "English must stay the identity mapping");
  for (const lang of LANGUAGES) {
    if (lang === "en") continue;
    assert.deepEqual(Object.keys(DICTS[lang]).sort(), reference, `dictionary drift in ${lang}`);
  }
});

test("no translation is empty or left untranslated", () => {
  for (const lang of LANGUAGES) {
    if (lang === "en") continue;
    for (const [key, value] of Object.entries(DICTS[lang])) {
      assert.ok(value.trim().length > 0, `${lang}: empty translation for ${key}`);
      assert.notEqual(value, key, `${lang}: still English for ${key}`);
    }
  }
});

test("translateText is identity for English and looks up every other language", () => {
  assert.equal(translateText("en", "Open"), "Open");
  assert.equal(translateText("zh", "Open"), "打开");
  assert.equal(translateText("ja", "Open"), "開く");
  assert.equal(translateText("ko", "Open"), "열기");
  assert.equal(translateText("ja", "Not a key"), "Not a key");
});

test("status messages are translated in every language", () => {
  assert.equal(translateStatusFor("en", "Playing"), "Playing");
  assert.equal(translateStatusFor("zh", "Playing"), "播放中");
  assert.equal(translateStatusFor("ja", "Playing"), "再生中");
  assert.equal(translateStatusFor("ko", "Playing"), "재생 중");
  assert.equal(translateStatusFor("ja", "Band detect: +3 cuts"), "帯域検出：+3 カット");
  assert.equal(translateStatusFor("ko", "Grid: 8 per measure"), "그리드: 마디당 8");
  assert.equal(translateStatusFor("zh", "Grid: 2 per measure"), "网格：每小节 2 格");
  assert.equal(translateStatusFor("ja", "Totally unknown"), "Totally unknown");
});

test("idle status strings fall back to the chrome dictionary", () => {
  // The initial status text is not a pattern message; it must still translate.
  assert.equal(
    translateStatusFor("en", "Empty: drop a WAV/OGG file to begin"),
    "Empty: drop a WAV/OGG file to begin"
  );
  assert.equal(translateStatusFor("zh", "Empty: drop a WAV/OGG file to begin"), "空：拖入 WAV/OGG 文件开始");
  assert.equal(
    translateStatusFor("ja", "Empty: drop a WAV/OGG file to begin"),
    "空：WAV/OGG ファイルをドロップして開始"
  );
  assert.equal(
    translateStatusFor("ko", "Empty: drop a WAV/OGG file to begin"),
    "비어 있음: WAV/OGG 파일을 놓아 시작"
  );
  assert.equal(translateStatusFor("ko", "No source loaded"), "소스가 로드되지 않음");
});

test("every status shape has a rule in every non-English language", () => {
  const samples = [
    "Playing",
    "Paused",
    "Stopped",
    "Break point at tick 12",
    "Break point already at tick 12",
    "Added marker at tick 5",
    "Marker already at tick 5",
    "Painted 3 marker(s)",
    "Erased 2 marker(s)",
    "Marker toggled at tick 9",
    "Selected 4 marker(s)",
    "Moved 4 marker(s) by -8 ticks",
    "Quantized selected marker(s) to grid 8",
    "Copied 3 marker(s) as relative group",
    "Pasted 3 marker(s) at tick 96",
    "Exported 7 slices",
    "Exporting 7 slices",
    "Band detect: +2 cuts",
    "Band detect: 0 cuts",
    "Tap offset applied: -12.5 ms",
    "Tap calibration finished",
    "Calibration closed",
    "Playback rate: 0.75×",
    "Grid: 4 per measure",
  ];
  for (const lang of ["zh", "ja", "ko"] as const) {
    for (const message of samples) {
      assert.notEqual(translateStatusFor(lang, message), message, `${lang} left "${message}" untranslated`);
    }
  }
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

test("isLanguage gates the IPC payload", () => {
  assert.equal(isLanguage("ja"), true);
  assert.equal(isLanguage("ko"), true);
  assert.equal(isLanguage("zh"), true);
  assert.equal(isLanguage("fr"), false);
  assert.equal(isLanguage(null), false);
  assert.equal(isLanguage(7), false);
  assert.equal(isLanguage(""), false);
});
