export interface Point {
  x: number;
  y: number;
}
export type Terrain = 'soil' | 'fertile' | 'rock' | 'water';
export type Resource = 'wood' | 'stone' | 'food' | 'waste';
export type FoodType = 'raw' | 'meal';
export type WeatherKind = 'clear' | 'rain' | 'heavy-rain';
export type ActivityKind =
  'sleeping' | 'resting' | 'walking' | 'light-work' | 'working' | 'heavy-work' | 'hauling';
export type BuildingKind = 'wall' | 'door' | 'bed' | 'cooking';
export type NodeKind = 'tree' | 'stone' | 'berries';
export type WorkType = 'plants' | 'haul' | 'build' | 'cook';
export type JobKind =
  | 'chop'
  | 'gather'
  | 'haul'
  | 'deliver'
  | 'build'
  | 'eat'
  | 'sleep'
  | 'move'
  | 'sow'
  | 'harvest'
  | 'cook'
  | 'separate'
  | 'deconstruct';
export interface Stack {
  resource: Resource;
  quantity: number;
  foodType?: FoodType;
  foodKind?: 'berries' | 'staple';
  freshPoints?: number;
  spoiledPoints?: number;
}
export interface Item extends Point, Stack {
  id: string;
  spoilsAt?: number;
  spoiled?: boolean;
}
export interface ResourceNode extends Point {
  id: string;
  kind: NodeKind;
  designated: boolean;
  work: number;
}
export interface Crop extends Point {
  id: string;
  kind: 'grain';
  growth: number;
}
export interface Building extends Point {
  id: string;
  kind: BuildingKind;
  deconstructing?: boolean;
  ownerId?: string;
  ingredientFresh?: number;
  cookingProgress?: number;
  reservedBy?: string;
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
  amount?: number;
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
  illnessUntil?: number;
  moodBias?: number;
  activity?: ActivityKind;
  productivity?: number;
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
  crops: Crop[];
  growingZones: number[];
  items: Item[];
  buildings: Building[];
  blueprints: Blueprint[];
  stockpiles: number[];
  pawns: Pawn[];
  events: GameEvent[];
  weather: WeatherKind;
  weatherUntil: number;
}
export type Command =
  | { type: 'designate'; points: Point[]; cancel?: boolean }
  | { type: 'blueprint'; points: Point[]; kind: BuildingKind }
  | { type: 'stockpile'; points: Point[] }
  | { type: 'growing'; points: Point[]; cancel?: boolean }
  | { type: 'deconstruct'; points: Point[] }
  | { type: 'priority'; pawnId: string; work: WorkType; value: number };
