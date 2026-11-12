import { MENU_COMMANDS } from './menu';

export const APP_COMMANDS = [
  ...MENU_COMMANDS,
  'play-pause',
  'place-breakpoint',
  'preview',
  'preview-previous',
  'grid-down',
  'grid-up',
  'bmse-out',
  'bmse-in',
  'clear-selection',
  'clip-number-down',
  'clip-number-up',
  'toggle-ff',
  'toggle-marker',
  'rate-down',
  'rate-up',
  'shift-all-minus',
  'shift-all-plus',
  'measure-paste',
  'cursor-left-tick',
  'cursor-right-tick',
  'cursor-left-grid',
  'cursor-right-grid',
  'cursor-up-measure',
  'cursor-down-measure',
] as const;

export type AppCommand = (typeof APP_COMMANDS)[number];

export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === 'string' && APP_COMMANDS.some((command) => command === value);
}
