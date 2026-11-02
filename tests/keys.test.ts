import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { GRID_CYCLE, resolveAction, handleKeyDown, KeyActions, FocusKind } from "../src/renderer/keys.js";
import { Store } from "../src/renderer/store.js";

const WAVE: FocusKind = "other";

test("Space maps to play/pause ONLY on the waveform focus (never a break point)", () => {
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: " " }), "play-pause");
  // Focused form fields and buttons keep native Space behaviour.
  assert.equal(resolveAction("input", { ctrl: false, shift: false, key: " " }), null);
  assert.equal(resolveAction("select", { ctrl: false, shift: false, key: " " }), null);
  assert.equal(resolveAction("textarea", { ctrl: false, shift: false, key: " " }), null);
  assert.equal(resolveAction("button", { ctrl: false, shift: false, key: " " }), null);
});

test("Enter places a break point on the waveform, activates a focused button", () => {
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "Enter" }), "place-breakpoint");
  assert.equal(resolveAction("button", { ctrl: false, shift: false, key: "Enter" }), null);
  assert.equal(resolveAction("input", { ctrl: false, shift: false, key: "Enter" }), null);
});

test("P keeps the slice preview role taken over from the old Enter binding", () => {
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "p" }), "preview");
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "o" }), "preview-previous");
});

test("[ / ] step the monitor rate down / up on the waveform focus", () => {
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "[" }), "rate-down");
  assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key: "]" }), "rate-up");
  // Rate keys stay keyboard shortcuts, not native typing: fields ignore them.
  assert.equal(resolveAction("input", { ctrl: false, shift: false, key: "[" }), null);
  assert.equal(resolveAction("input", { ctrl: false, shift: false, key: "]" }), null);
});

test("form fields swallow every shortcut (typing 'z' must not place a marker)", () => {
  for (const focus of ["input", "select", "textarea"] as const) {
    for (const key of ["z", "ArrowLeft", " ", "Enter", "c", "7", "["]) {
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

test("Enter forwards altKey to placeBreakpoint; focus gating unchanged", () => {
  const bypassCalls: boolean[] = [];
  const actions = {
    placeBreakpoint(bypassSnap: boolean): void {
      bypassCalls.push(bypassSnap);
    },
  } as unknown as KeyActions;

  const press = (target: unknown, altKey: boolean): void =>
    handleKeyDown(new Store(), actions, {
      target,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey,
      key: "Enter",
      preventDefault() {},
    });

  press(null, false); // waveform focus, no Alt -> snap applies
  press(null, true); // Alt held -> bypass flag travels with the event
  assert.deepEqual(bypassCalls, [false, true]);

  // Gating untouched: a focused input still swallows Enter entirely.
  press({ tagName: "INPUT" }, true);
  assert.deepEqual(bypassCalls, [false, true]);
});

test("grid cycle includes the coarse half-measure and whole-measure steps first", () => {
  assert.deepEqual(GRID_CYCLE, [1, 2, 4, 6, 8, 12, 16, 24, 32]);
});

test("Q steps grid down through 4 -> 2 -> 1 and clamps at the whole measure", () => {
  const store = new Store();
  store.update({ grid: 4 });
  const actions = {} as unknown as KeyActions;
  const press = (key: string): void =>
    handleKeyDown(store, actions, {
      target: null,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      key,
      preventDefault() {},
    });
  press("q");
  assert.equal(store.state.grid, 2);
  press("q");
  assert.equal(store.state.grid, 1);
  press("q");
  assert.equal(store.state.grid, 1, "Q must clamp at the whole-measure cell");
});

test("W steps grid up from 1 through 2 -> 4 and the ladder stays ordered", () => {
  const store = new Store();
  store.update({ grid: 1 });
  const actions = {} as unknown as KeyActions;
  const press = (key: string): void =>
    handleKeyDown(store, actions, {
      target: null,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      key,
      preventDefault() {},
    });
  press("w");
  assert.equal(store.state.grid, 2);
  press("w");
  assert.equal(store.state.grid, 4);
  for (let i = 0; i < 100; i++) press("w");
  assert.equal(store.state.grid, 32, "W must clamp at the finest cell");
  for (let i = 0; i < 100; i++) press("q");
  assert.equal(store.state.grid, 1, "Q reaches the whole measure from anywhere");
});

test("the command-bar Grid select lists exactly GRID_CYCLE in order", () => {
  const html = readFileSync(
    path.join(__dirname, "..", "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const block = html.match(/<select id="select-grid"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(block, "select-grid not found in index.html");
  const values = [...block[1].matchAll(/<option value="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(values, GRID_CYCLE);
});

test("',' and '.' place break points just like Enter", () => {
  for (const key of [",", "."]) {
    assert.equal(resolveAction(WAVE, { ctrl: false, shift: false, key }), "place-breakpoint", key);
  }
  // Form fields still swallow them (typing a comma must never place a marker).
  assert.equal(resolveAction("input", { ctrl: false, shift: false, key: "," }), null);
});
