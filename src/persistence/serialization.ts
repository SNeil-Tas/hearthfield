import { BUILDINGS, NODES, TERRAIN, SPOILED_FOOD_LIFETIME } from '../sim/definitions';
import type { WeatherKind } from '../sim/types';
import { Reservations } from '../sim/reservations';
import { interruptJob } from '../sim/jobs';
import type { World } from '../sim/types';

export interface SaveEnvelope {
  version: 1 | 2 | 3 | 4 | 5;
  savedAt: number;
  checksum: string;
  payload: string;
}
export function checksum(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function encode(w: World): SaveEnvelope {
  const payload = JSON.stringify(w);
  return { version: 5, savedAt: Date.now(), checksum: checksum(payload), payload };
}
function migrate(world: any, version: 1 | 2 | 3 | 4 | 5) {
  world.dumpZones ??= [];
  world.weather ??= 'clear';
  world.weatherUntil ??= world.tick + 1800;
  world.weatherStartedAt ??= world.tick;
  if (version === 1) {
    world.crops ??= [];
    world.growingZones ??= [];
    for (const pawn of world.pawns ?? []) {
      pawn.skills ??= {};
      pawn.priorities ??= {};
      pawn.skills.cook ??= 3;
      pawn.priorities.cook ??= 2;
    }
    for (const item of world.items ?? []) if (item.resource === 'food') item.foodType ??= 'raw';
  }
  for (const item of world.items ?? []) {
    if (item.resource === 'food') {
      item.foodType ??= 'raw';
      if (item.foodType === 'raw') {
        item.spoiledPoints ??= item.spoiled ? item.quantity : 0;
        item.freshPoints ??= Math.max(0, item.quantity - item.spoiledPoints);
        item.foodKind ??= 'staple';
      }
    }
    if (item.resource === 'waste' && !item.expiryBatches)
      item.expiryBatches = [
        { quantity: item.quantity, expiresAt: (world.tick ?? 0) + SPOILED_FOOD_LIFETIME },
      ];
  }
  world.items = (world.items ?? []).filter((item: any) => {
    if (item.resource !== 'food' || item.foodType !== 'raw') return true;
    const fresh = item.freshPoints ?? item.quantity;
    const spoiled = item.spoiledPoints ?? 0;
    if (fresh <= 1e-6 && spoiled <= 1e-6) return false;
    if (fresh <= 1e-6 && spoiled > 0) {
      item.resource = 'waste';
      delete item.foodType;
      delete item.foodKind;
      item.quantity = spoiled;
      item.expiryBatches = [
        { quantity: spoiled, expiresAt: (world.tick ?? 0) + SPOILED_FOOD_LIFETIME },
      ];
    }
    return true;
  });
  for (const building of world.buildings ?? []) {
    building.ingredientFresh ??= 0;
    building.cookingProgress ??= 0;
  }
  if (version <= 2) {
    world.weather ??= 'clear';
    world.weatherUntil ??= world.tick + 1800;
    for (const item of world.items ?? []) {
      if (item.resource === 'food')
        item.spoilsAt ??= world.tick + (item.foodType === 'meal' ? 9000 : 18000);
    }
    for (const pawn of world.pawns ?? []) {
      pawn.moodBias ??= 0;
      pawn.productivity ??= 1;
    }
  }
  for (const pawn of world.pawns ?? []) {
    pawn.rotExposure ??= 0;
    pawn.wetness ??= 0;
    pawn.rotHandledPenalty ??= 0;
  }
  return world;
}
export function validateWorld(value: unknown): asserts value is World {
  if (!value || typeof value !== 'object') throw new Error('Save has no world.');
  const w = value as World;
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const integer = (v: unknown, min: number, max: number) =>
    finite(v, min, max) && Number.isInteger(v);
  if (
    !integer(w.width, 8, 160) ||
    !integer(w.height, 8, 160) ||
    !integer(w.tick, 0, Number.MAX_SAFE_INTEGER) ||
    !integer(w.nextId, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(w.seed, 0, 4294967295)
  )
    throw new Error('Invalid world metadata.');
  for (const name of [
    'terrain',
    'nodes',
    'crops',
    'growingZones',
    'items',
    'buildings',
    'blueprints',
    'stockpiles',
    'dumpZones',
    'pawns',
    'events',
  ] as const)
    if (!Array.isArray(w[name]) || w[name].length > 50000) throw new Error(`Invalid ${name}.`);
  if (w.terrain.length !== w.width * w.height || w.terrain.some((t) => !Object.hasOwn(TERRAIN, t)))
    throw new Error('Invalid terrain.');
  const ids = new Set<string>();
  for (const e of [...w.nodes, ...w.items, ...w.buildings, ...w.blueprints])
    if (!e || !Number.isInteger(e.x) || !Number.isInteger(e.y))
      throw new Error('Invalid tile position.');
  const entities = [
    ...w.nodes,
    ...w.crops,
    ...w.items,
    ...w.buildings,
    ...w.blueprints,
    ...w.pawns,
  ];
  for (const e of entities) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !/^[a-z]+-\d+$/.test(e.id) ||
      ids.has(e.id) ||
      !finite(e.x, 0, w.width - 1) ||
      !finite(e.y, 0, w.height - 1)
    )
      throw new Error('Invalid entity.');
    if (Number(e.id.split('-')[1]) >= w.nextId) throw new Error('Invalid entity sequence.');
    ids.add(e.id);
  }
  for (const n of w.nodes)
    if (
      !Object.hasOwn(NODES, n.kind) ||
      typeof n.designated !== 'boolean' ||
      !finite(n.work, 0, 1000)
    )
      throw new Error('Invalid resource node.');
  if (
    w.crops.some(
      (c) =>
        !/^crop-\d+$/.test(c.id) ||
        !Number.isInteger(c.x) ||
        !Number.isInteger(c.y) ||
        c.kind !== 'grain' ||
        !finite(c.growth, 0, 1.25),
    ) ||
    w.growingZones.some((k) => !integer(k, 0, w.width * w.height - 1))
  )
    throw new Error('Invalid agriculture.');
  for (const b of [...w.buildings, ...w.blueprints])
    if (!Object.hasOwn(BUILDINGS, b.kind)) throw new Error('Invalid building.');
  for (const b of w.blueprints)
    if (!integer(b.delivered, 0, BUILDINGS[b.kind].cost) || !finite(b.work, 0, 1000000))
      throw new Error('Invalid blueprint.');
  const validStack = (i: {
    resource: string;
    quantity: number;
    foodType?: string;
    freshPoints?: number;
    spoiledPoints?: number;
  }) =>
    ['wood', 'stone', 'food', 'waste'].includes(i.resource) &&
    ((i.resource === 'food' && i.foodType === 'raw') || i.resource === 'waste'
      ? finite(i.quantity, 0, 100000) && i.quantity > 0
      : integer(i.quantity, 1, 100000)) &&
    (i.resource !== 'food' || !i.foodType || ['raw', 'meal'].includes(i.foodType)) &&
    (i.freshPoints === undefined || finite(i.freshPoints, 0, 100000)) &&
    (i.spoiledPoints === undefined || finite(i.spoiledPoints, 0, 100000));
  if (
    w.items.some((i) => !validStack(i)) ||
    w.stockpiles.some((k) => !integer(k, 0, w.width * w.height - 1)) ||
    w.dumpZones.some((k) => !integer(k, 0, w.width * w.height - 1))
  )
    throw new Error('Invalid inventory.');
  if (
    !['clear', 'rain', 'heavy-rain', 'storm'].includes(w.weather) ||
    !integer(w.weatherUntil, w.tick, Number.MAX_SAFE_INTEGER) ||
    (w.weatherStartedAt !== undefined && !integer(w.weatherStartedAt, 0, w.tick))
  )
    throw new Error('Invalid weather.');
  if (w.pawns.length < 1 || w.pawns.length > 50) throw new Error('Invalid colonist count.');
  for (const p of w.pawns) {
    if (p.wetness !== undefined && !finite(p.wetness, 0, 100)) throw new Error('Invalid wetness.');
    if (typeof p.name !== 'string' || p.name.length > 60 || !/^#[0-9a-f]{6}$/i.test(p.color))
      throw new Error('Invalid colonist identity.');
    if (['health', 'hunger', 'rest', 'mood'].some((k) => !finite(p[k as 'health'], 0, 100)))
      throw new Error('Invalid needs.');
    for (const type of ['plants', 'build', 'haul', 'cook'] as const)
      if (
        !p.skills ||
        !p.priorities ||
        !integer(p.skills[type], 0, 20) ||
        !integer(p.priorities[type], 0, 4)
      )
        throw new Error('Invalid work profile.');
    if (p.carrying !== null && (!p.carrying || !validStack(p.carrying)))
      throw new Error('Invalid carried item.');
  }
  for (const e of w.events)
    if (
      !e ||
      !integer(e.tick, 0, w.tick) ||
      typeof e.text !== 'string' ||
      e.text.length > 300 ||
      !['info', 'success', 'warning'].includes(e.kind)
    )
      throw new Error('Invalid event.');
}
export function decode(raw: unknown): { world: World; savedAt: number } {
  if (!raw || typeof raw !== 'object') throw new Error('Unrecognised save.');
  const e = raw as SaveEnvelope;
  if (e.version !== 1 && e.version !== 2 && e.version !== 3 && e.version !== 4 && e.version !== 5)
    throw new Error('This save needs a different game version.');
  if (
    typeof e.payload !== 'string' ||
    e.payload.length > 10000000 ||
    e.checksum !== checksum(e.payload) ||
    !Number.isFinite(e.savedAt)
  )
    throw new Error('Save integrity check failed.');
  const world: unknown = migrate(JSON.parse(e.payload), e.version);
  validateWorld(world);
  // Jobs are ephemeral. Resume from physical state, releasing all locks and dropping cargo.
  // This also makes future scheduler migrations independent of the persistent schema.
  const reservations = new Reservations();
  for (const pawn of world.pawns) interruptJob(world, pawn, reservations);
  return { world, savedAt: e.savedAt };
}
