import { DAY_TICKS } from './definitions';
import type { Building, Item, Pawn, Point, World } from './types';

export const DIAGNOSTIC_CAPACITY = 5000;

export interface DiagnosticEvent {
  tick: number;
  gameTime: string;
  type: string;
  entityId?: string;
  entityName?: string;
  targetId?: string;
  jobId?: string;
  jobType?: string;
  phase?: string;
  position?: Point;
  reason?: string;
  values?: Record<string, string | number | boolean | null>;
  realTime: string;
}

export class DiagnosticLog {
  private events: DiagnosticEvent[] = [];
  constructor(private readonly capacity = DIAGNOSTIC_CAPACITY) {}
  record(
    world: World,
    type: string,
    data: Omit<DiagnosticEvent, 'tick' | 'gameTime' | 'realTime' | 'type'> = {},
  ) {
    const minute = Math.floor(((world.tick % DAY_TICKS) / DAY_TICKS) * 24 * 60);
    const hour = (minute / 60 + 6) % 24;
    const time = `${String(Math.floor(hour)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    this.events.push({
      tick: world.tick,
      gameTime: `Day ${Math.floor(world.tick / DAY_TICKS) + 1} ${time}`,
      type,
      realTime: new Date().toISOString(),
      ...data,
    });
    if (this.events.length > this.capacity)
      this.events.splice(0, this.events.length - this.capacity);
  }
  snapshot() {
    return this.events.slice();
  }
  marker(world: World, note?: string) {
    this.record(world, 'USER_MARKER', { reason: note || undefined });
  }
}

export function jobId(pawn: Pawn) {
  return pawn.job ? `${pawn.id}:${pawn.job.kind}:${pawn.job.targetId ?? 'none'}` : undefined;
}

export function point(value?: Point) {
  return value ? { x: Math.round(value.x), y: Math.round(value.y) } : undefined;
}

export function diagnosticItem(
  item: Item,
  reservations: { owner(key: string): string | undefined },
) {
  return {
    id: item.id,
    tile: point(item),
    resource: item.resource,
    foodType: item.foodType,
    freshPoints: item.freshPoints ?? null,
    spoiledPoints: item.spoiledPoints ?? null,
    quantity: item.quantity,
    reservedBy: reservations.owner(item.id) ?? null,
    carriedBy: null,
    spoiled: item.spoiled ?? false,
  };
}

export function colonistDebugText(
  world: World,
  pawn: Pawn,
  reservations: { owner(key: string): string | undefined },
) {
  const station = pawn.job?.targetId
    ? world.buildings.find((b) => b.id === pawn.job?.targetId && b.kind === 'cooking')
    : undefined;
  const locks =
    pawn.job?.keys.map(
      (key) => `${key}${reservations.owner(key) === pawn.id ? '' : ' (owner mismatch)'}`,
    ) ?? [];
  return [
    `Colonist: ${pawn.name} [${pawn.id}]`,
    `Tile: ${Math.round(pawn.x)},${Math.round(pawn.y)}`,
    `Hunger: ${pawn.hunger.toFixed(1)}`,
    `Rest: ${pawn.rest.toFixed(1)}`,
    `Mood: ${pawn.mood.toFixed(1)}`,
    `Activity: ${pawn.activity ?? 'none'}`,
    `Job: ${pawn.job?.kind ?? 'none'}`,
    `Phase: ${pawn.job?.phase ?? 'none'}`,
    `Target: ${pawn.job?.targetId ?? 'none'}`,
    `Carrying: ${pawn.carrying ? `${pawn.carrying.quantity} ${pawn.carrying.resource} (${pawn.carrying.foodType ?? 'n/a'})` : 'none'}`,
    `Reservations: ${locks.length ? locks.join(', ') : 'none'}`,
    `Food plan: ${pawn.job?.kind === 'cook' ? 'cook' : pawn.job?.kind === 'eat' ? 'eat' : 'none'}`,
    `Station buffer: ${station ? `${station.ingredientFresh ?? 0}/100` : 'n/a'}`,
    `Cook progress: ${station ? `${Math.min(100, Math.round(((station.cookingProgress ?? 0) / 8) * 100))}%` : 'n/a'}`,
    `Path: ${pawn.job?.path.length ? `${pawn.job.path.length} tiles` : 'none'}`,
  ].join('\n');
}

export function buildDebugReport(
  world: World,
  reservations: {
    owner(key: string): string | undefined;
    snapshot(): { key: string; owner: string }[];
  },
  log: DiagnosticLog,
  metadata: Record<string, unknown>,
  speed: number,
) {
  const carried = new Map<string, string>();
  for (const pawn of world.pawns)
    if (pawn.carrying) carried.set(`${pawn.carrying.resource}:${pawn.carrying.quantity}`, pawn.id);
  return {
    report: 'hearthfield-debug',
    reportVersion: 1,
    exportedAt: new Date().toISOString(),
    build: metadata,
    simulation: {
      tick: world.tick,
      day: Math.floor(world.tick / DAY_TICKS) + 1,
      time: `Day ${Math.floor(world.tick / DAY_TICKS) + 1}`,
      speed,
      weather: world.weather,
      paused: speed === 0,
    },
    colonists: world.pawns.map((pawn) => ({
      id: pawn.id,
      name: pawn.name,
      position: point(pawn),
      hunger: pawn.hunger,
      rest: pawn.rest,
      mood: pawn.mood,
      health: pawn.health,
      illness:
        pawn.illnessUntil && pawn.illnessUntil > world.tick ? { until: pawn.illnessUntil } : null,
      activity: pawn.activity ?? null,
      job: pawn.job,
      carrying: pawn.carrying,
      reservations: pawn.job?.keys ?? [],
      foodPlan: pawn.job?.kind === 'cook' ? 'cook' : pawn.job?.kind === 'eat' ? 'eat' : null,
      claimedBed:
        world.buildings.find((b) => b.kind === 'bed' && b.ownerId === pawn.id)?.id ?? null,
      path: pawn.job
        ? { target: pawn.job.targetId ?? null, remaining: pawn.job.path.length }
        : null,
    })),
    cookingStations: world.buildings
      .filter((b) => b.kind === 'cooking')
      .map((b) => ({
        ...diagnosticBuilding(b, reservations),
        activeJob: world.pawns.find((pawn) => pawn.id === b.reservedBy)?.job ?? null,
        blockedReason: b.reservedBy ? null : 'available',
      })),
    items: world.items
      .filter((item) => item.resource === 'food' || item.resource === 'waste')
      .map((item) => ({
        ...diagnosticItem(item, reservations),
        carriedBy:
          [...world.pawns].find((p) => p.carrying && p.carrying.resource === item.resource)?.id ??
          null,
      })),
    reservations: reservations.snapshot(),
    recentEvents: log.snapshot(),
  };
}

export function diagnosticBuilding(
  building: Building,
  reservations: { owner(key: string): string | undefined },
) {
  return {
    id: building.id,
    tile: point(building),
    kind: building.kind,
    reservationOwner: building.reservedBy ?? reservations.owner(building.id) ?? null,
    activeColonist: building.reservedBy ?? null,
    bufferFresh: building.ingredientFresh ?? 0,
    cookingProgress: building.cookingProgress ?? 0,
  };
}
