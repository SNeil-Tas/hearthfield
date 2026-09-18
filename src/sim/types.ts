export interface Point {
  x: number;
  y: number;
}
export type Terrain = 'soil' | 'fertile' | 'rock' | 'water';
export type Resource = 'wood' | 'stone' | 'food';
export type BuildingKind = 'wall' | 'door' | 'bed';
export type NodeKind = 'tree' | 'stone' | 'berries';
export type WorkType = 'plants' | 'haul' | 'build';
export type JobKind = 'chop' | 'gather' | 'haul' | 'deliver' | 'build' | 'eat' | 'sleep' | 'move';
export interface Stack {
  resource: Resource;
  quantity: number;
}
export interface Item extends Point, Stack {
  id: string;
}
export interface ResourceNode extends Point {
  id: string;
  kind: NodeKind;
  designated: boolean;
  work: number;
}
export interface Building extends Point {
  id: string;
  kind: BuildingKind;
}
export interface Blueprint extends Building {
  delivered: number;
  work: number;
}
export interface Job {
  kind: JobKind;
  sourceId?: string;
  targetId?: string;
  destination: Point;
  path: Point[];
  phase: 'source' | 'target';
  progress: number;
  keys: string[];
}
export interface Pawn extends Point {
  id: string;
  name: string;
  color: string;
  health: number;
  hunger: number;
  rest: number;
  mood: number;
  skills: Record<WorkType, number>;
  priorities: Record<WorkType, number>;
  job: Job | null;
  carrying: Stack | null;
}
export interface GameEvent {
  tick: number;
  text: string;
  kind: 'info' | 'warning' | 'success';
}
export interface World {
  seed: number;
  width: number;
  height: number;
  tick: number;
  nextId: number;
  terrain: Terrain[];
  nodes: ResourceNode[];
  items: Item[];
  buildings: Building[];
  blueprints: Blueprint[];
  stockpiles: number[];
  pawns: Pawn[];
  events: GameEvent[];
}
export type Command =
  | { type: 'designate'; points: Point[]; cancel?: boolean }
  | { type: 'blueprint'; points: Point[]; kind: BuildingKind }
  | { type: 'stockpile'; points: Point[] }
  | { type: 'priority'; pawnId: string; work: WorkType; value: number };
