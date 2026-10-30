import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAction, type FocusKind } from "../src/renderer/keys.js";

const WAVE: FocusKind = "other";

test("Space maps to play/pause or break-point ONLY on the waveform focus", () => {
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: " " }), "play-pause-or-breakpoint");
  // Focused form fields and buttons keep native Space behaviour.
  assert.equal(resolveAction("input", { ctrl: false, shift: false, key: " " }), null);
  assert.equal(resolveAction("select", { ctrl: false, shift: false, key: " " }), null);
  assert.equal(resolveAction("textarea", { ctrl: false, shift: false, key: " " }), null);
  assert.equal(resolveAction("button", { ctrl: false, shift: false, key: " " }), null);
});

test("Enter on a focused button activates the button, on the waveform it previews", () => {
  assert.equal(resolveAction("button", { ctrl: false, shift: false, key: "Enter" }), null);
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "Enter" }), "preview");
});

test("form fields swallow every shortcut (typing 'z' must not place a marker)", () => {
  for (const focus of ["input", "select", "textarea"] as const) {
    for (const key of ["z", "ArrowLeft", " ", "c", "7"]) {
      assert.equal(resolveAction(focus, { ctrl: false, shift: false, key }), null, `${focus} "${key}"`);
    }
    assert.equal(resolveAction(focus, { ctrl: true, shift: false, key: "c" }), null, `${focus} Ctrl+C`);
  }
});

test("original single-key semantics are preserved on the waveform focus", () => {
  const k = (key: string, shift = false): string | null =>
    resolveAction(WAVE, { ctrl: false, shift, key });
  assert.equal(k("z"), "toggle-marker");
  assert.equal(k("p"), "preview");
  assert.equal(k("o"), "preview-previous");
  assert.equal(k("q"), "grid-down");
  assert.equal(k("w"), "grid-up");
  assert.equal(k("m"), "export-all");
  assert.equal(k("v"), "bmse-out");
  assert.equal(k("b"), "bmse-in");
  assert.equal(k("a"), "clip-number-down");
  assert.equal(k("s"), "clip-number-up");
  assert.equal(k("n"), "toggle-ff");
  assert.equal(k("t"), "save-wos");
  assert.equal(k("y"), "load-wos");
  assert.equal(k("c"), "clear-markers");
  assert.equal(k("7"), "shift-all-minus");
  assert.equal(k("8"), "shift-all-plus");
  assert.equal(k("ArrowLeft"), "cursor-left-grid");
  assert.equal(k("ArrowRight"), "cursor-right-grid");
  assert.equal(k("ArrowUp"), "cursor-up-measure");
  assert.equal(k("ArrowDown"), "cursor-down-measure");
  assert.equal(k("ArrowLeft", true), "cursor-left-tick");
  assert.equal(k("ArrowRight", true), "cursor-right-tick");
  assert.equal(k("Escape"), "clear-selection");
  assert.equal(k("x"), null, "plain X is not a shortcut");
});

test("Ctrl+X/C/V map to the selection model; Ctrl+F stays the measure alias", () => {
  const c = (key: string, shift = false): string | null =>
    resolveAction(WAVE, { ctrl: true, shift, key });
  assert.equal(c("c"), "select-copy");
  assert.equal(c("x"), "select-cut");
  assert.equal(c("v"), "select-paste");
  assert.equal(c("f"), "measure-paste");
  assert.equal(c("z"), "undo");
  assert.equal(c("z", true), "redo");
  assert.equal(c("y"), "redo");
  assert.equal(c("e"), "export-slice");
  assert.equal(c("e", true), "export-all");
  assert.equal(c("s"), "save-wos");
});

test("unhandled keys return null even with modifiers", () => {
  assert.equal(resolveAction(WAVE, { ctrl: true, shift: true, key: "q" }), null);
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "F5" }), null);
});
