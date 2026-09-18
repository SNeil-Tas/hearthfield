import type { BuildingKind, NodeKind, Resource, Terrain, WorkType } from './types';

export const TICK_SECONDS = 0.1;
export const DAY_TICKS = 6000;
export const TERRAIN: Record<Terrain, { color: string; passable: boolean; label: string }> = {
  soil: { color: '#7a8960', passable: true, label: 'Meadow' },
  fertile: { color: '#687e50', passable: true, label: 'Fertile soil' },
  rock: { color: '#969687', passable: true, label: 'Rocky ground' },
  water: { color: '#557f83', passable: false, label: 'Deep water' },
};
export const RESOURCES: Record<Resource, { label: string; color: string }> = {
  wood: { label: 'Wood', color: '#c99963' },
  stone: { label: 'Stone', color: '#b9c2be' },
  food: { label: 'Food', color: '#e2af69' },
};
export const BUILDINGS: Record<
  BuildingKind,
  { label: string; cost: number; work: number; blocks: boolean; description: string }
> = {
  wall: {
    label: 'Wall',
    cost: 5,
    work: 4,
    blocks: true,
    description: 'A sturdy timber wall. Blocks movement.',
  },
  door: {
    label: 'Door',
    cost: 8,
    work: 5,
    blocks: false,
    description: 'A passage through your shelter. Colonists open it automatically.',
  },
  bed: {
    label: 'Bed',
    cost: 10,
    work: 6,
    blocks: false,
    description: 'A comfortable place to rest. Faster recovery than sleeping outside.',
  },
  cooking: {
    label: 'Cooking station',
    cost: 12,
    work: 8,
    blocks: false,
    description: 'Turns four raw food into one satisfying meal.',
  },
};
export const NODES: Record<
  NodeKind,
  { label: string; resource: Resource; yield: number; work: number }
> = {
  tree: { label: 'Pine tree', resource: 'wood', yield: 16, work: 5 },
  stone: { label: 'Stone outcrop', resource: 'stone', yield: 12, work: 7 },
  berries: { label: 'Berry bush', resource: 'food', yield: 14, work: 3 },
};
export const WORK: Record<WorkType, string> = {
  plants: 'Gather',
  build: 'Build',
  haul: 'Haul',
  cook: 'Cook',
};
export const JOB_LABELS = {
  chop: 'Cutting timber',
  gather: 'Gathering',
  haul: 'Hauling to storage',
  deliver: 'Delivering wood',
  build: 'Constructing',
  eat: 'Finding food',
  sleep: 'Resting',
  move: 'Making room',
  sow: 'Sowing crops',
  harvest: 'Harvesting crops',
  cook: 'Cooking meals',
  deconstruct: 'Taking apart',
};
export const CROP_GROWTH_TICKS = 2400;
export const COOKING_INPUT = 4;
