import { describe, expect, it } from 'vitest';
import {
  menuCommandEnabled,
  MENU_COMMANDS,
  type MenuCommand,
  type MenuEditorState,
} from '../../src/app/menu';
import { APP_COMMANDS } from '../../src/app/command-types';

const state = (overrides: Partial<MenuEditorState> = {}): MenuEditorState => ({
  document: { media: [], tracks: [] } as unknown as MenuEditorState['document'],
  source: null,
  ticks: [],
  selectedTicks: [],
  canUndo: false,
  canRedo: false,
  limited: false,
  ...overrides,
});
const withSource = state({
  source: { name: 'a' } as unknown as MenuEditorState['source'],
  ticks: [12],
});
const limited = state({
  limited: true,
  ticks: [12],
  selectedTicks: [12],
  document: { media: [{}] } as unknown as MenuEditorState['document'],
});

const table: ReadonlyArray<readonly [MenuCommand, MenuEditorState, boolean]> = [
  // Always available: project replacement, explicit save, close, view helpers.
  ['open-project', state(), true],
  ['new-project-wos', limited, true],
  ['save-project', limited, true],
  ['close-project', limited, true],
  ['zoom-in', limited, true],
  ['zoom-out', limited, true],
  ['about', limited, true],
  // Content and WOS transfer refuse read-only projects.
  ['open-audio', limited, false],
  ['open-audio', withSource, true],
  ['import-wos', limited, false],
  ['import-legacy', limited, false],
  ['export-wos', limited, false],
  // Relink needs media and an editable project.
  ['relink-audio', state(), false],
  ['relink-audio', limited, false],
  [
    'relink-audio',
    state({ document: { media: [{}] } as unknown as MenuEditorState['document'] }),
    true,
  ],
  // Exports need a decoded source and at least one cut.
  ['export-slice', state(), false],
  ['export-slice', state({ source: { name: 'a' } as unknown as MenuEditorState['source'] }), false],
  ['export-slice', withSource, true],
  ['export-all', withSource, true],
  // History availability mirrors the editor.
  ['undo', state({ canUndo: true }), true],
  ['undo', withSource, false],
  ['redo', state({ canRedo: true }), true],
  // Selection helpers need markers; destructive ones refuse read-only projects.
  ['select-all', withSource, true],
  ['select-all', state(), false],
  ['select-copy', withSource, true],
  ['clear-markers', withSource, true],
  ['clear-markers', limited, false],
  ['select-cut', state({ ticks: [12], selectedTicks: [12] }), true],
  ['select-cut', limited, false],
  ['select-paste', limited, false],
  ['select-paste', state(), true],
];

describe('menu availability rules', () => {
  it('covers every menu command exactly once in the rule table', () => {
    const ids = new Set(table.map(([id]) => id));
    for (const id of MENU_COMMANDS) expect(ids.has(id)).toBe(true);
    for (const id of table.map(([id]) => id)) expect(MENU_COMMANDS).toContain(id);
  });
  it.each(table)('enables %s per the shared rule', (id, editorState, expected) => {
    expect(menuCommandEnabled(id, editorState)).toBe(expected);
  });
  it('keeps menu commands inside the application command set', () => {
    for (const id of MENU_COMMANDS) expect(APP_COMMANDS).toContain(id);
  });
});
