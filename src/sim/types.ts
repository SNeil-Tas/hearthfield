export interface Point {
  x: number;
  y: number;
}
export type Terrain = 'soil' | 'fertile' | 'rock' | 'water';
export type LandscapeKind =
  'river-valley' | 'twin-lakes' | 'marsh-edge' | 'highland-creek' | 'wooded-basin';
export interface Landscape {
  kind: LandscapeKind;
  name: string;
  description: string;
}
export type CropType = 'potato' | 'grain' | 'berry';
export type CropStage = 'seeded' | 'germinating' | 'seedling' | 'growing' | 'mature';
export type Resource = 'wood' | 'stone' | 'food' | 'waste' | 'seed' | 'fertilizer';
export type FoodType = 'raw' | 'meal';
export type WeatherKind = 'clear' | 'rain' | 'heavy-rain' | 'storm';
export type AnimalSpecies = 'rabbit' | 'deer' | 'boar' | 'bison' | 'fox' | 'wolf';
export type AnimalStage = 'juvenile' | 'adult' | 'elder';
export type AnimalState = 'roaming' | 'foraging' | 'hunting' | 'fleeing' | 'feeding' | 'resting';
export type ColonyGoalId =
  | 'first-bed'
  | 'food-buffer'
  | 'first-field'
  | 'first-harvest'
  | 'cooking-fire'
  | 'first-meal'
  | 'first-home';
export type WaterSourceClass = 'fresh' | 'brackish' | 'saltwater';
export type ActivityKind =
  'sleeping' | 'resting' | 'walking' | 'light-work' | 'working' | 'heavy-work' | 'hauling';
export type InjuryKind = 'bruise' | 'cut' | 'sprain' | 'burn';
export interface Injury {
  id: string;
  kind: InjuryKind;
  bodyPart: 'head' | 'torso' | 'arm' | 'leg';
  severity: number;
  inflictedAt: number;
  healsAt: number;
}
export type RelationshipTier = 'rival' | 'acquaintance' | 'friend' | 'close-friend';
export type LifeStage =
  'infancy' | 'early-childhood' | 'pubescence' | 'post-pubescence' | 'adulthood';
export interface Pregnancy {
  partnerId: string;
  conceivedAt: number;
  dueAt: number;
}
export interface Relationship {
  targetId: string;
  /** This colonist's directed opinion of the target, from hostility to affection. */
  opinion: number;
  familiarity: number;
  interactions: number;
  lastInteractionAt: number;
  tier: RelationshipTier;
}
export type BuildingKind = 'wall' | 'door' | 'bed' | 'cooking';
export type NodeKind = 'tree' | 'stone' | 'berries';
export type WorkType = 'plants' | 'haul' | 'build' | 'cook';
export type JobKind =
  | 'care'
  | 'chop'
  | 'gather'
  | 'haul'
  | 'deliver'
  | 'build'
  | 'eat'
  | 'sleep'
  | 'move'
  | 'sow'
  | 'water'
  | 'fertilize'
  | 'harvest'
  | 'cook'
  | 'separate'
  | 'deconstruct';
export interface Stack {
  spoilsAt?: number;
  spoiled?: boolean;
  resource: Resource;
  quantity: number;
  foodType?: FoodType;
  foodKind?: 'berries' | 'staple';
  seedType?: CropType;
  freshPoints?: number;
  spoiledPoints?: number;
  expiryBatches?: ExpiryBatch[];
}
export interface Item extends Point, Stack {
  id: string;
  spoilsAt?: number;
  spoiled?: boolean;
  expiryBatches?: ExpiryBatch[];
}
export interface ExpiryBatch {
  quantity: number;
  expiresAt: number;
}
export interface ResourceNode extends Point {
  id: string;
  kind: NodeKind;
  designated: boolean;
  work: number;
}
export interface Animal extends Point {
  id: string;
  species: AnimalSpecies;
  sex: 'female' | 'male';
  ageTicks: number;
  energy: number;
  health: number;
  state: AnimalState;
  nextMoveAt: number;
  nextBreedAt: number;
  nextAttackAt: number;
  huntTargetId?: string;
}
export interface Crop extends Point {
  id: string;
  kind: CropType;
  growth: number;
  stallReason?: 'dry' | 'wet' | 'nutrients' | 'salinity';
}
export interface AgricultureTile {
  key: number;
  cropType: CropType;
  moisture: number;
  nutrients: number;
  /** Abstract 0-100 soil salt burden; intentionally not a calibrated real-world unit. */
  salinity: number;
  lastWateredAt?: number;
  lastWateredBy?: string;
  lastWaterSalinity?: number;
  lastFertilizedAt?: number;
}
export interface WaterSalinityTile {
  key: number;
  /** Abstract 0-100 irrigation-water salinity. Missing water tiles are fresh (0). */
  salinity: number;
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
  escortingChild?: boolean;
  kind: JobKind;
  sourceId?: string;
  sourceKind?: 'water';
  targetId?: string;
  destination: Point;
  path: Point[];
  phase: 'source' | 'target';
  progress: number;
  keys: string[];
  amount?: number;
  waterAmount?: number;
  waterSalinity?: number;
  waterSourceClass?: WaterSourceClass;
  waterSourceKey?: number;
  cookTransactionId?: string;
  waitingForSource?: boolean;
  personalFoodPlan?: boolean;
  separationProgress?: number;
  postedJobId?: string;
}
export interface PostedJob {
  id: string;
  key: string;
  kind: JobKind;
  work: WorkType;
  sourceId?: string;
  targetId?: string;
  destination: Point;
  postedBy: string;
  postedAt: number;
  claimedBy?: string;
}
export interface Pawn extends Point {
  id: string;
  name: string;
  color: string;
  health: number;
  /** Total simulated lifetime, including the colonist's age before arrival. */
  ageTicks: number;
  lifespanYears: number;
  sex: 'female' | 'male';
  orientation: 'heterosexual' | 'homosexual' | 'bisexual';
  /** Baseline can later be changed by life events and environmental influences. */
  agingOnsetYears: number;
  partnerId?: string;
  parentIds: string[];
  /** Retained ancestry prevents close-family pairings after parents die. */
  ancestorIds: string[];
  pregnancy?: Pregnancy;
  nextConceptionAt: number;
  care: number;
  caregiverId?: string;
  injuries: Injury[];
  relationships: Relationship[];
  hunger: number;
  rest: number;
  mood: number;
  skills: Record<WorkType, number>;
  knowledge: { agriculture: number };
  priorities: Record<WorkType, number>;
  job: Job | null;
  carrying: Stack | null;
  illnessUntil?: number;
  moodBias?: number;
  activity?: ActivityKind;
  productivity?: number;
  wetness?: number;
  rotExposure?: number;
  rotHandledUntil?: number;
  rotHandledPenalty?: number;
}
export interface GameEvent {
  tick: number;
  text: string;
  kind: 'info' | 'warning' | 'success';
}
export interface World {
  seed: number;
  landscape: Landscape;
  width: number;
  height: number;
  tick: number;
  nextId: number;
  terrain: Terrain[];
  nodes: ResourceNode[];
  animals: Animal[];
  wildForage: number[];
  crops: Crop[];
  growingZones: number[];
  agriculture: AgricultureTile[];
  waterSalinity: WaterSalinityTile[];
  items: Item[];
  buildings: Building[];
  blueprints: Blueprint[];
  stockpiles: number[];
  dumpZones: number[];
  pawns: Pawn[];
  events: GameEvent[];
  jobPosts: PostedJob[];
  completedGoals?: ColonyGoalId[];
  weather: WeatherKind;
  weatherUntil: number;
  weatherStartedAt?: number;
}
export type Command =
  | { type: 'designate'; points: Point[]; cancel?: boolean }
  | { type: 'blueprint'; points: Point[]; kind: BuildingKind }
  | { type: 'stockpile'; points: Point[] }
  | { type: 'dump'; points: Point[]; cancel?: boolean }
  | { type: 'growing'; points: Point[]; cancel?: boolean }
  | { type: 'crop'; point: Point; cropType: CropType }
  | { type: 'deconstruct'; points: Point[] }
  | { type: 'priority'; pawnId: string; work: WorkType; value: number };
