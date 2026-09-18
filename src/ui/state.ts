import type { Point } from '../sim/types';
export type Tool =
  'inspect' | 'gather' | 'cancel' | 'wall' | 'door' | 'bed' | 'cooking' | 'stockpile' | 'grow';
export type Panel = 'architect' | 'orders' | 'work' | 'journal' | 'settings' | null;
export interface UIState {
  tool: Tool;
  panel: Panel;
  selectedId: string | null;
  selectedTile: Point | null;
  preview: Point[];
  debug: boolean;
  guide: boolean;
  toast: string;
}
export const initialUI = (): UIState => {
  let guide = true;
  try {
    guide = !localStorage.getItem('hearthfield-guide');
  } catch {
    /* Private storage may be unavailable. */
  }
  return {
    tool: 'inspect',
    panel: null,
    selectedId: null,
    selectedTile: null,
    preview: [],
    debug: false,
    guide,
    toast: '',
  };
};
