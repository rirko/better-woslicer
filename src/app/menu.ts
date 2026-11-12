import type { EditorStore } from '../slicing/editor-store';
import type { MenuCommand } from './command-types';

export type MenuEditorState = Pick<
  EditorStore,
  'document' | 'source' | 'ticks' | 'selectedTicks' | 'canUndo' | 'canRedo' | 'limited'
>;
export interface ApplicationMenuItem {
  id: MenuCommand;
  key: string;
  enabled: () => boolean;
}
export interface ApplicationMenuGroup {
  label: 'menu.project' | 'menu.edit' | 'menu.view';
  commands: readonly ApplicationMenuItem[];
}

/**
 * One availability rule shared by the menu's disabled state and command
 * execution, so no entry can drift from the actual workspace gates.
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

export function createApplicationMenu(editor: MenuEditorState): readonly ApplicationMenuGroup[] {
  return [
    {
      label: 'menu.project',
      commands: [
        {
          id: 'open-project',
          key: 'menu.openProject',
          enabled: () => menuCommandEnabled('open-project', editor),
        },
        // Limited projects still save: the opened file's bytes are written unchanged.
        {
          id: 'save-project',
          key: 'menu.saveProject',
          enabled: () => menuCommandEnabled('save-project', editor),
        },
        {
          id: 'relink-audio',
          key: 'menu.relinkAudio',
          enabled: () => menuCommandEnabled('relink-audio', editor),
        },
        {
          id: 'open-audio',
          key: 'menu.openAudio',
          enabled: () => menuCommandEnabled('open-audio', editor),
        },
        {
          id: 'new-project-wos',
          key: 'menu.newProjectWos',
          enabled: () => menuCommandEnabled('new-project-wos', editor),
        },
        {
          id: 'import-wos',
          key: 'menu.importWos',
          enabled: () => menuCommandEnabled('import-wos', editor),
        },
        {
          id: 'import-legacy',
          key: 'menu.importLegacy',
          enabled: () => menuCommandEnabled('import-legacy', editor),
        },
        {
          id: 'export-wos',
          key: 'menu.exportWos',
          enabled: () => menuCommandEnabled('export-wos', editor),
        },
        {
          id: 'close-project',
          key: 'chrome.close',
          enabled: () => menuCommandEnabled('close-project', editor),
        },
        {
          id: 'export-slice',
          key: 'menu.exportSlice',
          enabled: () => menuCommandEnabled('export-slice', editor),
        },
        {
          id: 'export-all',
          key: 'menu.exportAll',
          enabled: () => menuCommandEnabled('export-all', editor),
        },
      ],
    },
    {
      label: 'menu.edit',
      commands: [
        { id: 'undo', key: 'menu.undo', enabled: () => menuCommandEnabled('undo', editor) },
        { id: 'redo', key: 'menu.redo', enabled: () => menuCommandEnabled('redo', editor) },
        {
          id: 'select-all',
          key: 'menu.selectAll',
          enabled: () => menuCommandEnabled('select-all', editor),
        },
        {
          id: 'clear-markers',
          key: 'menu.clearMarkers',
          enabled: () => menuCommandEnabled('clear-markers', editor),
        },
        {
          id: 'select-copy',
          key: 'menu.copySelection',
          enabled: () => menuCommandEnabled('select-copy', editor),
        },
        {
          id: 'select-cut',
          key: 'menu.cutSelection',
          enabled: () => menuCommandEnabled('select-cut', editor),
        },
        {
          id: 'select-paste',
          key: 'menu.pasteSelection',
          enabled: () => menuCommandEnabled('select-paste', editor),
        },
      ],
    },
    {
      label: 'menu.view',
      commands: [
        { id: 'zoom-in', key: 'menu.zoomIn', enabled: () => menuCommandEnabled('zoom-in', editor) },
        {
          id: 'zoom-out',
          key: 'menu.zoomOut',
          enabled: () => menuCommandEnabled('zoom-out', editor),
        },
        { id: 'about', key: 'menu.about', enabled: () => menuCommandEnabled('about', editor) },
      ],
    },
  ];
}
