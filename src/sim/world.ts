import {
  TERRAIN,
  BUILDINGS,
  FOOD_STACK_CAP,
  SPOILED_STACK_CAP,
  SPOILED_FOOD_LIFETIME,
  SPOILAGE_SEPARATION_THRESHOLD,
} from './definitions';
import type { ExpiryBatch, FoodType, Point, Resource, World } from './types';

export const tileKey = (w: World, p: Point) => Math.round(p.y) * w.width + Math.round(p.x);
export const sameTile = (a: Point, b: Point) =>
  Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const nextId = (w: World, prefix: string) => `${prefix}-${w.nextId++}`;
export const inside = (w: World, p: Point) =>
  p.x >= 0 && p.y >= 0 && p.x < w.width && p.y < w.height;
export function walkable(w: World, p: Point) {
  return (
    inside(w, p) &&
    TERRAIN[w.terrain[tileKey(w, p)]!].passable &&
    !w.buildings.some((b) => BUILDINGS[b.kind].blocks && sameTile(b, p)) &&
    !w.nodes.some((n) => n.kind !== 'berries' && sameTile(n, p)) &&
    !w.items.some((i) => sameTile(i, p))
  );
}
export const FOOD_LIFETIME: Record<FoodType, number> = { raw: 2 * 6000, meal: 1.25 * 6000 };
export function freshPoints(item: { resource: Resource; quantity: number; freshPoints?: number }) {
  return item.resource === 'food' ? (item.freshPoints ?? item.quantity) : 0;
}
export function spoiledPoints(item: { resource: Resource; spoiledPoints?: number }) {
  return item.resource === 'food' ? (item.spoiledPoints ?? 0) : 0;
}
export function foodPoints(item: {
  resource: Resource;
  quantity: number;
  foodType?: FoodType;
  freshPoints?: number;
}) {
  return item.resource !== 'food'
    ? 0
    : item.foodType === 'meal'
      ? item.quantity * 80
      : freshPoints(item);
}
export function hasAdjacentWaste(w: World, item: Point) {
  return w.items.some(
    (other) =>
      other.resource === 'waste' &&
      Math.abs(Math.round(other.x) - Math.round(item.x)) <= 1 &&
      Math.abs(Math.round(other.y) - Math.round(item.y)) <= 1,
  );
}
export function isFoodSpoiled(
  w: World,
  item: { resource: Resource; spoiled?: boolean; spoilsAt?: number; spoiledPoints?: number },
) {
  return (
    item.resource === 'food' &&
    (item.spoiled === true ||
      (item.spoiledPoints ?? 0) > 0 ||
      (item.spoilsAt !== undefined && w.tick >= item.spoilsAt))
  );
}
export function drop(
  w: World,
  p: Point,
  resource: Resource,
  quantity: number,
  type: FoodType = 'raw',
  foodKind: 'berries' | 'staple' = 'staple',
) {
  let remaining =
    resource === 'food' && type === 'raw'
      ? Math.max(0, quantity)
      : Math.max(0, Math.round(quantity));
  while (remaining > 1e-6) {
    const amount =
      resource === 'food' && type === 'raw'
        ? Math.min(FOOD_STACK_CAP, remaining)
        : Math.max(1, Math.round(remaining));
    w.items.push({
      id: nextId(w, 'item'),
      x: Math.round(p.x),
      y: Math.round(p.y),
      resource,
      quantity: amount,
      ...(resource === 'food'
        ? {
            foodType: type,
            foodKind,
            freshPoints: type === 'raw' ? amount : 0,
            spoiledPoints: 0,
            spoilsAt: w.tick + FOOD_LIFETIME[type],
          }
        : {}),
    });
    remaining -= amount;
  }
}
export function dropFood(
  w: World,
  p: Point,
  quantity: number,
  type: FoodType = 'raw',
  foodKind: 'berries' | 'staple' = 'staple',
) {
  drop(w, p, 'food', quantity, type, foodKind);
}
export function dropWaste(w: World, p: Point, quantity: number) {
  addSpoiledFood(w, p, quantity, w.tick + SPOILED_FOOD_LIFETIME);
}
export function addSpoiledFood(w: World, p: Point, quantity: number, expiresAt: number) {
  let remaining = Math.max(0, quantity);
  const candidates = w.items.filter(
    (item) =>
      item.resource === 'waste' && sameTile(item, p) && (item.expiryBatches?.length ?? 0) > 0,
  );
  for (const item of candidates) {
    const capacity = SPOILED_STACK_CAP - item.quantity;
    if (capacity <= 1e-6) continue;
    const amount = Math.min(capacity, remaining);
    item.quantity += amount;
    item.expiryBatches = [...(item.expiryBatches ?? []), { quantity: amount, expiresAt }];
    remaining -= amount;
    if (remaining <= 1e-6) return;
  }
  while (remaining > 1e-6) {
    const amount = Math.min(SPOILED_STACK_CAP, remaining);
    w.items.push({
      id: nextId(w, 'waste'),
      x: Math.round(p.x),
      y: Math.round(p.y),
      resource: 'waste',
      quantity: amount,
      expiryBatches: [{ quantity: amount, expiresAt }],
    });
    remaining -= amount;
  }
}
export function dropStack(
  w: World,
  p: Point,
  stack: {
    resource: Resource;
    quantity: number;
    foodType?: FoodType;
    foodKind?: 'berries' | 'staple';
    expiryBatches?: ExpiryBatch[];
  },
) {
  if (stack.resource === 'waste') {
    if (stack.expiryBatches?.length) {
      for (const batch of stack.expiryBatches)
        addSpoiledFood(w, p, batch.quantity, batch.expiresAt);
    } else {
      addSpoiledFood(w, p, stack.quantity, w.tick + SPOILED_FOOD_LIFETIME);
    }
    return;
  }
  drop(w, p, stack.resource, stack.quantity, stack.foodType, stack.foodKind);
}
export function takeExpiryBatches(item: { expiryBatches?: ExpiryBatch[] }, quantity: number) {
  let remaining = quantity;
  const taken: ExpiryBatch[] = [];
  const kept: ExpiryBatch[] = [];
  for (const batch of item.expiryBatches ?? []) {
    const amount = Math.min(batch.quantity, Math.max(0, remaining));
    if (amount > 1e-6) taken.push({ quantity: amount, expiresAt: batch.expiresAt });
    if (batch.quantity - amount > 1e-6)
      kept.push({ quantity: batch.quantity - amount, expiresAt: batch.expiresAt });
    remaining -= amount;
  }
  item.expiryBatches = kept;
  return taken;
}
export function requiresFoodSeparation(item: { resource: Resource; spoiledPoints?: number }) {
  return item.resource === 'food' && spoiledPoints(item) > SPOILAGE_SEPARATION_THRESHOLD;
}
export function isDumpTile(w: World, p: Point) {
  return w.dumpZones.includes(tileKey(w, p));
}
export function advanceWasteDecay(w: World) {
  for (const item of [...w.items]) {
    if (item.resource !== 'waste' || !item.expiryBatches?.length) continue;
    const remaining = item.expiryBatches.filter((batch) => batch.expiresAt > w.tick);
    const quantity = remaining.reduce((total, batch) => total + batch.quantity, 0);
    if (quantity <= 1e-6) w.items = w.items.filter((candidate) => candidate.id !== item.id);
    else {
      item.expiryBatches = remaining;
      item.quantity = quantity;
    }
  }
}
export function foodType(item: { resource: Resource; foodType?: FoodType }): FoodType {
  return item.resource === 'food' && item.foodType === 'meal' ? 'meal' : 'raw';
}
export function resourceTotal(w: World, resource: Resource) {
  const total =
    w.items.filter((i) => i.resource === resource).reduce((n, i) => n + i.quantity, 0) +
    w.pawns.reduce((n, p) => n + (p.carrying?.resource === resource ? p.carrying.quantity : 0), 0);
  return Math.round(total * 1e6) / 1e6;
}
export function advanceFoodSpoilage(w: World, item: any, sheltered: Set<number>) {
  if (item.resource !== 'food' || foodType(item) !== 'raw') return undefined;
  const fresh = freshPoints(item);
  if (fresh <= 1e-6) {
    if (spoiledPoints(item) <= 1e-6)
      w.items = w.items.filter((candidate) => candidate.id !== item.id);
    else {
      const spoiled = spoiledPoints(item);
      const expiresAt =
        item.spoilsAt !== undefined && item.spoilsAt > w.tick
          ? item.spoilsAt
          : w.tick + SPOILED_FOOD_LIFETIME;
      w.items = w.items.filter((candidate) => candidate.id !== item.id);
      addSpoiledFood(w, item, spoiled, expiresAt);
      return {
        itemId: item.id,
        freshBefore: fresh,
        spoiledBefore: spoiled,
        spoiledFoodCreated: spoiled,
      };
    }
    return undefined;
  }
  const indoor = sheltered.has(tileKey(w, item));
  const weather = indoor ? 1 : w.weather === 'heavy-rain' ? 1.35 : w.weather === 'rain' ? 1.12 : 1;
  const rate =
    (0.55 / FOOD_LIFETIME.raw) *
    weather *
    (hasAdjacentWaste(w, item) ? 2 : 1) *
    (indoor ? 0.78 : 1);
  const converted = Math.min(fresh, fresh * rate * 100);
  item.freshPoints = fresh - converted;
  item.spoiledPoints = (item.spoiledPoints ?? 0) + converted;
  item.quantity = item.freshPoints + item.spoiledPoints;
  item.spoiled = item.spoiledPoints > 0;
  if (item.quantity <= 1e-6) w.items = w.items.filter((candidate) => candidate.id !== item.id);
  return undefined;
}
export function shelteredTiles(w: World) {
  const blocked = (p: Point) =>
    !inside(w, p) || w.buildings.some((b) => sameTile(b, p) && ['wall', 'door'].includes(b.kind));
  const outside = new Uint8Array(w.width * w.height),
    queue: Point[] = [];
  for (let x = 0; x < w.width; x++) queue.push({ x, y: 0 }, { x, y: w.height - 1 });
  for (let y = 1; y < w.height - 1; y++) queue.push({ x: 0, y }, { x: w.width - 1, y });
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++]!,
      key = tileKey(w, p);
    if (outside[key] || blocked(p)) continue;
    outside[key] = 1;
    for (const n of [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ])
      if (inside(w, n) && !outside[tileKey(w, n)]) queue.push(n);
  }
  const sheltered = new Set<number>();
  for (let key = 0; key < outside.length; key++) if (!outside[key]) sheltered.add(key);
  return sheltered;
}
