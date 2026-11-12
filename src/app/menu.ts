import type { EditorStore } from '../slicing/editor-store';

export type MenuEditorState = Pick<
  EditorStore,
  'document' | 'source' | 'ticks' | 'selectedTicks' | 'canUndo' | 'canRedo' | 'limited'
>;

// The visible menu is also the source of its command type and input validation.
export const APPLICATION_MENU = [
  {
    label: 'menu.project',
    commands: [
      { id: 'open-project', key: 'menu.openProject' },
      // Limited projects still save: the opened file's bytes are written unchanged.
      { id: 'save-project', key: 'menu.saveProject' },
      { id: 'relink-audio', key: 'menu.relinkAudio' },
      { id: 'open-audio', key: 'menu.openAudio' },
      { id: 'new-project-wos', key: 'menu.newProjectWos' },
      { id: 'import-wos', key: 'menu.importWos' },
      { id: 'import-legacy', key: 'menu.importLegacy' },
      { id: 'export-wos', key: 'menu.exportWos' },
      { id: 'close-project', key: 'chrome.close' },
      { id: 'export-slice', key: 'menu.exportSlice' },
      { id: 'export-all', key: 'menu.exportAll' },
    ],
  },
  {
    label: 'menu.edit',
    commands: [
      { id: 'undo', key: 'menu.undo' },
      { id: 'redo', key: 'menu.redo' },
      { id: 'select-all', key: 'menu.selectAll' },
      { id: 'clear-markers', key: 'menu.clearMarkers' },
      { id: 'select-copy', key: 'menu.copySelection' },
      { id: 'select-cut', key: 'menu.cutSelection' },
      { id: 'select-paste', key: 'menu.pasteSelection' },
    ],
  },
  {
    label: 'menu.view',
    commands: [
      { id: 'zoom-in', key: 'menu.zoomIn' },
      { id: 'zoom-out', key: 'menu.zoomOut' },
      { id: 'about', key: 'menu.about' },
    ],
  },
] as const;

export type MenuCommand = (typeof APPLICATION_MENU)[number]['commands'][number]['id'];
export const MENU_COMMANDS = APPLICATION_MENU.flatMap((group) =>
  group.commands.map((item) => item.id),
);

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && MENU_COMMANDS.some((command) => command === value);
}

/**
 * Menu availability reflects the workspace guards; commands also validate at
 * their mutation boundary because shortcuts and toolbars bypass this menu.
 */
export function menuCommandEnabled(id: MenuCommand, editor: MenuEditorState): boolean {
  switch (id) {
    case 'open-project':
    case 'new-project-wos':
    case 'save-project':
    case 'close-project':
    case 'zoom-in':
    case 'zoom-out':
    case 'about':
      return true;
    case 'open-audio':
    case 'import-wos':
    case 'import-legacy':
    case 'export-wos':
      return !editor.limited;
    case 'relink-audio':
      return editor.document.media.length > 0 && !editor.limited;
    case 'export-slice':
    case 'export-all':
      return editor.source !== null && editor.ticks.length > 0;
    case 'undo':
      return editor.canUndo;
    case 'redo':
      return editor.canRedo;
    case 'select-all':
    case 'select-copy':
      return editor.ticks.length > 0;
    case 'clear-markers':
      return editor.ticks.length > 0 && !editor.limited;
    case 'select-cut':
      return editor.selectedTicks.length > 0 && !editor.limited;
    case 'select-paste':
      return !editor.limited;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}
