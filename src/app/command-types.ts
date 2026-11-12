export const APP_COMMANDS = [
  'open-project', 'save-project', 'relink-audio',
  'open-audio', 'new-project-wos', 'import-wos', 'import-legacy', 'export-wos', 'close-project',
  'export-slice', 'export-all', 'undo', 'redo', 'select-copy', 'select-cut', 'select-paste',
  'select-all', 'clear-markers', 'zoom-in', 'zoom-out', 'about', 'play-pause', 'place-breakpoint',
  'preview', 'preview-previous', 'grid-down', 'grid-up', 'bmse-out', 'bmse-in', 'clear-selection',
  'clip-number-down', 'clip-number-up', 'toggle-ff', 'toggle-marker', 'rate-down', 'rate-up',
  'shift-all-minus', 'shift-all-plus', 'measure-paste', 'cursor-left-tick', 'cursor-right-tick',
  'cursor-left-grid', 'cursor-right-grid', 'cursor-up-measure', 'cursor-down-measure',
] as const;

export type AppCommand = (typeof APP_COMMANDS)[number];
export type MenuCommand = Extract<AppCommand,
  | 'open-project' | 'save-project' | 'relink-audio'
  | 'open-audio' | 'new-project-wos' | 'import-wos' | 'import-legacy' | 'export-wos' | 'close-project'
  | 'export-slice' | 'export-all' | 'undo' | 'redo' | 'select-copy' | 'select-cut' | 'select-paste'
  | 'select-all' | 'clear-markers' | 'zoom-in' | 'zoom-out' | 'about'
>;

export const MENU_COMMANDS: readonly MenuCommand[] = [
  'open-project', 'save-project', 'relink-audio',
  'open-audio', 'new-project-wos', 'import-wos', 'import-legacy', 'export-wos', 'close-project', 'export-slice', 'export-all',
  'undo', 'redo', 'select-copy', 'select-cut', 'select-paste', 'select-all', 'clear-markers',
  'zoom-in', 'zoom-out', 'about',
];

export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === 'string' && APP_COMMANDS.some(command => command === value);
}

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && MENU_COMMANDS.some(command => command === value);
}
