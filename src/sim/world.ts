import { TERRAIN, BUILDINGS } from './definitions';
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
    !w.nodes.some((n) => n.kind !== 'berries' && sameTile(n, p))
  );
}
export function drop(
  w: World,
  p: Point,
  resource: Resource,
  quantity: number,
  type: FoodType = 'raw',
) {
  if (quantity <= 0) return;
  // Separate stacks keep reservations stable when another pawn drops nearby.
  w.items.push({
    id: nextId(w, 'item'),
    x: Math.round(p.x),
    y: Math.round(p.y),
    resource,
    quantity,
    ...(resource === 'food' ? { foodType: type } : {}),
  });
}
export function dropFood(w: World, p: Point, quantity: number, foodType: FoodType = 'raw') {
  if (quantity <= 0) return;
  w.items.push({
    id: nextId(w, 'item'),
    x: Math.round(p.x),
    y: Math.round(p.y),
    resource: 'food',
    quantity,
    foodType,
  });
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
export function shelteredTiles(w: World) {
  const blocked = (p: Point) =>
    !inside(w, p) || w.buildings.some((b) => sameTile(b, p) && ['wall', 'door'].includes(b.kind));
  const outside = new Uint8Array(w.width * w.height);
  const queue: Point[] = [];
  for (let x = 0; x < w.width; x++) {
    queue.push({ x, y: 0 }, { x, y: w.height - 1 });
  }
  for (let y = 1; y < w.height - 1; y++) queue.push({ x: 0, y }, { x: w.width - 1, y });
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++]!;
    const key = tileKey(w, p);
    if (outside[key] || blocked(p)) continue;
    outside[key] = 1;
    for (const next of [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ])
      if (inside(w, next) && !outside[tileKey(w, next)]) queue.push(next);
  }
  const sheltered = new Set<number>();
  for (let key = 0; key < outside.length; key++) if (!outside[key]) sheltered.add(key);
  return sheltered;
}
