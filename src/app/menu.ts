import type { EditorStore } from '../slicing/editor-store';
import type { MenuCommand } from './command-types';

export interface ApplicationMenuItem {
  id: MenuCommand;
  key: string;
  enabled: () => boolean;
}
export interface ApplicationMenuGroup {
  label: 'menu.project' | 'menu.edit' | 'menu.view';
  commands: readonly ApplicationMenuItem[];
}

export function createApplicationMenu(editor: Pick<EditorStore, 'document' | 'source' | 'ticks' | 'selectedTicks' | 'canUndo' | 'canRedo'>): readonly ApplicationMenuGroup[] {
  return [
    { label: 'menu.project', commands: [
      { id: 'open-project', key: 'menu.openProject', enabled: () => true },
      { id: 'save-project', key: 'menu.saveProject', enabled: () => true },
      { id: 'relink-audio', key: 'menu.relinkAudio', enabled: () => editor.document.media.length > 0 },
      { id: 'open-audio', key: 'menu.openAudio', enabled: () => true },
      { id: 'import-wos', key: 'menu.importWos', enabled: () => true },
      { id: 'export-wos', key: 'menu.exportWos', enabled: () => true },
      { id: 'close-project', key: 'chrome.close', enabled: () => true },
      { id: 'export-slice', key: 'menu.exportSlice', enabled: () => editor.source !== null && editor.ticks.length > 0 },
      { id: 'export-all', key: 'menu.exportAll', enabled: () => editor.source !== null && editor.ticks.length > 0 },
    ] },
    { label: 'menu.edit', commands: [
      { id: 'undo', key: 'menu.undo', enabled: () => editor.canUndo },
      { id: 'redo', key: 'menu.redo', enabled: () => editor.canRedo },
      { id: 'select-all', key: 'menu.selectAll', enabled: () => editor.ticks.length > 0 },
      { id: 'clear-markers', key: 'menu.clearMarkers', enabled: () => editor.ticks.length > 0 },
      { id: 'select-copy', key: 'menu.copySelection', enabled: () => editor.ticks.length > 0 },
      { id: 'select-cut', key: 'menu.cutSelection', enabled: () => editor.selectedTicks.length > 0 },
      { id: 'select-paste', key: 'menu.pasteSelection', enabled: () => true },
    ] },
    { label: 'menu.view', commands: [
      { id: 'zoom-in', key: 'menu.zoomIn', enabled: () => true },
      { id: 'zoom-out', key: 'menu.zoomOut', enabled: () => true },
      { id: 'about', key: 'menu.about', enabled: () => true },
    ] },
  ];
}
