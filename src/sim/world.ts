import { TERRAIN, BUILDINGS, FOOD_STACK_CAP, SPOILED_STACK_CAP } from './definitions';
import type { FoodType, Point, Resource, World } from './types';

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
  let remaining = Math.max(0, Math.round(quantity));
  while (remaining > 0) {
    const amount =
      resource === 'food' && type === 'raw' ? Math.min(FOOD_STACK_CAP, remaining) : remaining;
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
  let remaining = Math.max(0, Math.round(quantity));
  while (remaining > 0) {
    const amount = Math.min(SPOILED_STACK_CAP, remaining);
    w.items.push({
      id: nextId(w, 'waste'),
      x: Math.round(p.x),
      y: Math.round(p.y),
      resource: 'waste',
      quantity: amount,
    });
    remaining -= amount;
  }
}
export function foodType(item: { resource: Resource; foodType?: FoodType }): FoodType {
  return item.resource === 'food' && item.foodType === 'meal' ? 'meal' : 'raw';
}
export function resourceTotal(w: World, resource: Resource) {
  return (
    w.items.filter((i) => i.resource === resource).reduce((n, i) => n + i.quantity, 0) +
    w.pawns.reduce((n, p) => n + (p.carrying?.resource === resource ? p.carrying.quantity : 0), 0)
  );
}
export function advanceFoodSpoilage(w: World, item: any, sheltered: Set<number>) {
  if (item.resource !== 'food' || foodType(item) !== 'raw') return;
  const fresh = freshPoints(item);
  if (fresh <= 0) return;
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
  item.quantity = Math.max(1, Math.round(item.freshPoints + item.spoiledPoints));
  item.spoiled = item.spoiledPoints > 0;
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
