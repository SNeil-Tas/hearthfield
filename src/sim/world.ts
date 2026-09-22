import { roomTopology } from './topology';
import { rainSpoilageMultiplier } from './weather';
import {
  TERRAIN,
  BUILDINGS,
  FOOD_STACK_CAP,
  SPOILED_STACK_CAP,
  SPOILED_FOOD_LIFETIME,
  SPOILAGE_SEPARATION_THRESHOLD,
  RESOURCE_CARRY_CAPACITY,
} from './definitions';
import type { ExpiryBatch, FoodType, Point, Resource, Stack, World } from './types';

export const tileKey = (w: World, p: Point) => Math.round(p.y) * w.width + Math.round(p.x);
export const sameTile = (a: Point, b: Point) =>
  Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const nextId = (w: World, prefix: string) => `${prefix}-${w.nextId++}`;
export function resourceBaseCarryCapacity(resource: Resource) {
  return RESOURCE_CARRY_CAPACITY[resource];
}
export function effectiveCarryCapacity(resource: Resource, pawnHaulingModifier = 1) {
  return resourceBaseCarryCapacity(resource) * pawnHaulingModifier;
}
export function stackCapacity(stack: { resource: Resource; foodType?: FoodType }) {
  if (stack.resource === 'food' && stack.foodType === 'raw') return FOOD_STACK_CAP;
  if (stack.resource === 'waste') return SPOILED_STACK_CAP;
  return Number.POSITIVE_INFINITY;
}
export const inside = (w: World, p: Point) =>
  p.x >= 0 && p.y >= 0 && p.x < w.width && p.y < w.height;
export function walkable(w: World, p: Point) {
  return (
    inside(w, p) &&
    TERRAIN[w.terrain[tileKey(w, p)]!].passable &&
    !w.buildings.some((b) => BUILDINGS[b.kind].blocks && sameTile(b, p)) &&
    !w.nodes.some((n) => n.kind !== 'berries' && sameTile(n, p))
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
export function compatibleStacks(
  a: { resource: Resource; foodType?: FoodType; foodKind?: 'berries' | 'staple' },
  b: { resource: Resource; foodType?: FoodType; foodKind?: 'berries' | 'staple' },
) {
  if (a.resource !== b.resource) return false;
  if (a.resource === 'food')
    return foodType(a) === foodType(b) && (a.foodKind ?? 'staple') === (b.foodKind ?? 'staple');
  return a.resource !== 'waste' || b.resource === 'waste';
}
function mergeInto(target: Stack, incoming: Stack, amount: number, w: World) {
  const freshBefore = freshPoints(target);
  target.quantity += amount;
  if (target.resource === 'food' && foodType(target) === 'raw') {
    target.freshPoints = freshBefore + freshPoints(incoming) * (amount / incoming.quantity);
    target.spoiledPoints =
      spoiledPoints(target) + spoiledPoints(incoming) * (amount / incoming.quantity);
    target.quantity = target.freshPoints + target.spoiledPoints;
    target.spoiled = target.spoiledPoints > 0;
    if (incoming.spoilsAt !== undefined)
      target.spoilsAt = Math.min(target.spoilsAt ?? incoming.spoilsAt, incoming.spoilsAt);
  }
  if (target.resource === 'food' && foodType(target) === 'meal')
    target.spoilsAt = Math.min(target.spoilsAt ?? w.tick, incoming.spoilsAt ?? w.tick);
}
/** Crops and growing zones are never storage, including overlapping legacy zones. */
export function validStorageTile(w: World, p: Point) {
  return (
    w.stockpiles.includes(tileKey(w, p)) &&
    walkable(w, p) &&
    !w.growingZones.includes(tileKey(w, p)) &&
    !w.crops.some((c) => sameTile(c, p)) &&
    !w.buildings.some((b) => sameTile(b, p)) &&
    !w.blueprints.some((b) => sameTile(b, p))
  );
}
function portionOf(stack: Stack, amount: number): Stack {
  return {
    resource: stack.resource,
    foodType: stack.foodType,
    foodKind: stack.foodKind,
    spoilsAt: stack.spoilsAt,
    spoiled: stack.spoiled,
    expiryBatches: stack.expiryBatches,
    quantity: amount,
    ...(stack.resource === 'food' && foodType(stack) === 'raw'
      ? {
          freshPoints: (freshPoints(stack) * amount) / stack.quantity,
          spoiledPoints: (spoiledPoints(stack) * amount) / stack.quantity,
        }
      : {}),
  };
}
/** Transfers only accepted inventory; caller retains the returned remainder. */
export function depositStack(w: World, p: Point, stack: Stack): number {
  if (!validStorageTile(w, p)) return stack.quantity;
  let remaining = stack.quantity;
  const tiles = [
    p,
    ...w.stockpiles
      .map((k) => ({ x: k % w.width, y: Math.floor(k / w.width) }))
      .filter((tile) => !sameTile(tile, p) && validStorageTile(w, tile)),
  ];
  for (const tile of tiles) {
    const occupants = w.items.filter((item) => sameTile(item, tile));
    for (const target of occupants.filter((item) => compatibleStacks(item, stack))) {
      const amount = Math.min(Math.max(0, stackCapacity(target) - target.quantity), remaining);
      if (amount > 1e-6) {
        mergeInto(target, portionOf(stack, amount), amount, w);
        remaining -= amount;
      }
    }
    if (!occupants.length && remaining > 1e-6) {
      const amount = Math.min(stackCapacity(stack), remaining);
      w.items.push({
        id: nextId(w, 'item'),
        x: Math.round(tile.x),
        y: Math.round(tile.y),
        ...portionOf(stack, amount),
      });
      remaining -= amount;
    }
    if (remaining <= 1e-6) return 0;
  }
  return remaining;
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
export function dropStack(w: World, p: Point, stack: Stack) {
  if (stack.resource === 'waste') {
    if (stack.expiryBatches?.length) {
      for (const batch of stack.expiryBatches)
        addSpoiledFood(w, p, batch.quantity, batch.expiresAt);
    } else {
      addSpoiledFood(w, p, stack.quantity, w.tick + SPOILED_FOOD_LIFETIME);
    }
    return;
  }
  const remaining = validStorageTile(w, p) ? depositStack(w, p, stack) : stack.quantity;
  // Ground drops transfer inventory; they must not rejuvenate food.
  let left = remaining;
  while (left > 1e-6) {
    const amount = Math.min(stackCapacity(stack), left);
    w.items.push({
      id: nextId(w, 'item'),
      x: Math.round(p.x),
      y: Math.round(p.y),
      ...portionOf(stack, amount),
    });
    left -= amount;
  }
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
export function usefulResourceTotal(w: World, resource: Resource) {
  if (resource !== 'food') return resourceTotal(w, resource);
  const total =
    w.items.reduce(
      (n, item) => n + (foodType(item) === 'meal' && isFoodSpoiled(w, item) ? 0 : foodPoints(item)),
      0,
    ) +
    w.buildings.reduce((n, b) => n + (b.kind === 'cooking' ? (b.ingredientFresh ?? 0) : 0), 0) +
    w.pawns.reduce(
      (n, p) =>
        n +
        (p.carrying?.resource === 'food'
          ? p.carrying.foodType === 'meal'
            ? isFoodSpoiled(w, p.carrying)
              ? 0
              : p.carrying.quantity * 80
            : freshPoints(p.carrying)
          : 0),
      0,
    );
  return Math.round(total * 1e6) / 1e6;
}
export function advanceFoodSpoilage(
  w: World,
  item: any,
  _legacySheltered?: Set<number>,
  onSpoiled?: (amount: number) => void,
) {
  if (item.resource !== 'food') return undefined;
  if (foodType(item) === 'meal') {
    if (isFoodSpoiled(w, item)) {
      onSpoiled?.(item.quantity * 80);
      w.items = w.items.filter((candidate) => candidate.id !== item.id);
      addSpoiledFood(w, item, item.quantity * 80, w.tick + SPOILED_FOOD_LIFETIME);
    }
    return undefined;
  }
  const fresh = freshPoints(item);
  if (fresh <= 1e-6) {
    if (fresh > 0) onSpoiled?.(fresh);
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
  const indoor = roomTopology(w).isIndoors(item);
  const weather = rainSpoilageMultiplier(w, item);
  const rate =
    (0.55 / FOOD_LIFETIME.raw) *
    weather *
    (hasAdjacentWaste(w, item) ? 2 : 1) *
    (indoor ? 0.78 : 1);
  const converted = Math.min(fresh, fresh * rate * 100);
  onSpoiled?.(converted);
  item.freshPoints = fresh - converted;
  item.spoiledPoints = (item.spoiledPoints ?? 0) + converted;
  item.quantity = item.freshPoints + item.spoiledPoints;
  item.spoiled = item.spoiledPoints > 0;
  if (item.quantity <= 1e-6) w.items = w.items.filter((candidate) => candidate.id !== item.id);
  return undefined;
}
/** Compatibility helper; new consumers should use O(1) topology queries. */
export function shelteredTiles(w: World) {
  const topology = roomTopology(w).ensure();
  const sheltered = new Set<number>();
  for (let k = 0; k < w.width * w.height; k++)
    if (topology.isSheltered({ x: k % w.width, y: Math.floor(k / w.width) })) sheltered.add(k);
  return sheltered;
}
