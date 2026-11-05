// Generates src/i18n/generated.ts from the i18n JSON data files.
//
// The JSON files are the editable source of truth (shared with the packager,
// which prunes the bundled Chromium locales from languages.json). The
// generated module exposes the same data with `as const` literal types, so
// the compiler derives the Language union, the chrome/status key unions and
// checks record exhaustiveness, while the app itself keeps plain JS imports:
// no runtime JSON loading, no import attributes, CommonJS main and
// native-ESM renderer both unchanged.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src", "i18n");
const outPath = path.join(srcDir, "generated.ts");
const sections = ["chrome", "status", "menu", "dialogs", "scopeRange"];

function fail(message) {
  throw new Error("gen-i18n: " + message);
}

function readJson(name) {
  const file = path.join(srcDir, name);
  if (!fs.existsSync(file)) fail("missing data file " + name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(name + " is not valid JSON: " + err.message);
  }
}

function requireString(container, key, where) {
  const value = container[key];
  if (typeof value !== "string" || value.trim().length === 0) fail(where + " requires a non-empty string " + key);
}

// Validate the manifest: it is the packager's input, so shape errors must
// stop the build here rather than surface as a broken release layout.
const manifest = readJson("languages.json");
if (typeof manifest !== "object" || manifest === null || !Array.isArray(manifest.languages)) {
  fail("languages.json must contain a languages array");
}
const seenIds = new Set();
const seenLocales = new Set();
for (const entry of manifest.languages) {
  if (typeof entry !== "object" || entry === null) fail("languages.json entries must be objects");
  requireString(entry, "id", "language entry");
  requireString(entry, "label", "language " + entry.id);
  requireString(entry, "docLang", "language " + entry.id);
  if (seenIds.has(entry.id)) fail("duplicate language id " + entry.id);
  seenIds.add(entry.id);
  if (!Array.isArray(entry.chromiumLocales) || entry.chromiumLocales.length === 0) {
    fail("language " + entry.id + " needs at least one chromium locale");
  }
  for (const locale of entry.chromiumLocales) {
    if (typeof locale !== "string" || !/^[a-z]{2,3}(-[A-Z][a-zA-Z]*)*$/.test(locale)) {
      fail("language " + entry.id + " has a malformed chromium locale: " + locale);
    }
    if (seenLocales.has(locale)) fail("chromium locale " + locale + " backs two languages");
    seenLocales.add(locale);
  }
}
if (!seenIds.has("en")) fail("languages.json must declare English (en); it is the fallback language");
// The language set is whatever the manifest declares — adding a language is a
// data change only (a new <id>.json plus one manifest entry), never a code change.
const languageFiles = manifest.languages.map((entry) => entry.id);

// Every language file must exist, be declared, and carry the identical key
// set per section as English; every {name} template placeholder must match
// the English reference exactly, so a translation can never drop or rename a
// parameter.
for (const id of languageFiles) {
  if (!seenIds.has(id)) fail(id + ".json exists but languages.json does not declare it");
}
for (const id of seenIds) {
  if (!languageFiles.includes(id)) fail("languages.json declares " + id + " but " + id + ".json is missing");
}

function placeholderNames(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
}

const reference = readJson("en.json");
if (typeof reference !== "object" || reference === null) fail("en.json must be an object");
for (const section of sections) {
  if (!(section in reference)) fail("en.json is missing the " + section + " section");
}
const refKeys = {};
for (const section of ["chrome", "status", "menu", "dialogs"]) {
  if (typeof reference[section] !== "object" || reference[section] === null) {
    fail("en.json " + section + " must be an object");
  }
  // Keep insertion order: sections must carry the same key ORDER in every
  // language so side-by-side translation review stays diffable.
  refKeys[section] = Object.keys(reference[section]);
}
if (refKeys.chrome.length === 0 || refKeys.status.length === 0) {
  fail("en.json chrome/status sections must not be empty");
}
for (const [key, value] of Object.entries({ ...reference.chrome, ...reference.status })) {
  if (typeof value !== "string" || value.length === 0) fail("en.json entry " + key + " must be a non-empty string");
}
for (const template of [reference.scopeRange, ...Object.values(reference.status)]) {
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(match[1])) {
      fail("en.json template placeholder {" + match[1] + "} is not a camelCase name");
    }
  }
}

for (const id of languageFiles) {
  const data = readJson(id + ".json");
  if (typeof data !== "object" || data === null) fail(id + ".json must be an object");
  for (const section of sections) {
    if (!(section in data)) fail(id + ".json is missing the " + section + " section");
  }
  for (const section of ["chrome", "status", "menu", "dialogs"]) {
    const keys = Object.keys(data[section]);
    if (keys.join(",") !== refKeys[section].join(",")) {
      fail(id + ".json " + section + " key set or order drifts from en.json: " + keys.join(","));
    }
    for (const [key, value] of Object.entries(data[section])) {
      if (typeof value !== "string" || value.trim().length === 0) {
        fail(id + ".json " + section + "." + key + " must be a non-empty string");
      }
    }
  }
  if (placeholderNames(data.scopeRange) !== placeholderNames(reference.scopeRange)) {
    fail(id + ".json scopeRange placeholders drift from en.json");
  }
  for (const [key, template] of Object.entries(data.status)) {
    if (placeholderNames(template) !== placeholderNames(reference.status[key])) {
      fail(id + ".json status." + key + " placeholders drift from en.json");
    }
  }
}

// Emit the generated module. JSON.stringify output is a valid TypeScript
// object literal; `as const` turns every string into its literal type.
// DATA is keyed by language id so consumers index it with a Language value
// straight from the manifest — a new language needs no consumer changes.
const parts = [
  "// Generated by scripts/gen-i18n.js from src/i18n/*.json. Do not edit;",
  "// regenerate with: npm run gen:i18n",
  "/* eslint-disable */",
  "export const MANIFEST = " + JSON.stringify(manifest, null, 2) + " as const;",
];
for (const id of languageFiles) {
  parts.push("export const " + id.toUpperCase() + " = " + JSON.stringify(readJson(id + ".json"), null, 2) + " as const;");
}
const dataEntries = languageFiles.map((id) => id + ": " + id.toUpperCase());
parts.push("export const DATA = {\n  " + dataEntries.join(",\n  ") + ",\n} as const;");
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(outPath, parts.join("\n\n") + "\n");
console.log("generated " + path.relative(root, outPath) + " from " + languageFiles.length + " language files");
