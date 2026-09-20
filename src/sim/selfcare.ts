import type { Pawn, World } from './types';
import { foodType, isFoodSpoiled } from './world';
import { findPath, navigationGrid } from './pathfinding';

// Shared by scheduling, critical preemption and exported diagnostics.
export function preparedMealOptions(
  w: World,
  pawn: Pawn,
  reservations: { owner(key: string): string | undefined },
  grid = navigationGrid(w),
) {
  return w.items
    .filter((item) => item.resource === 'food' && foodType(item) === 'meal')
    .map((item) => {
      const owner = reservations.owner(item.id);
      const edible = item.quantity >= 1 && !isFoodSpoiled(w, item);
      const path = edible ? findPath(w, pawn, item, true, grid) : null;
      return { item, path, edible, available: !owner || owner === pawn.id, owner };
    });
}
export function reachableMeal(
  w: World,
  pawn: Pawn,
  reservations: { owner(key: string): string | undefined },
  grid = navigationGrid(w),
) {
  return preparedMealOptions(w, pawn, reservations, grid)
    .filter((option) => option.available && option.path !== null)
    .sort((a, b) => a.path!.length - b.path!.length)[0];
}
