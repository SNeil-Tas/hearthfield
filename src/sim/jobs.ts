import { BUILDINGS, NODES, TICK_SECONDS } from './definitions';
import { emit } from './events';
import { findPath } from './pathfinding';
import { Reservations } from './reservations';
import type { Pawn, World } from './types';
import {
  drop,
  dropFood,
  dropWaste,
  foodType,
  freshPoints,
  spoiledPoints,
  nextId,
  sameTile,
  tileKey,
  isFoodSpoiled,
} from './world';
import { COOKED_MEAL_POINTS, COOKING_INPUT } from './definitions';

export function interruptJob(w: World, pawn: Pawn, reservations: Reservations) {
  const station =
    pawn.job?.kind === 'cook' ? w.buildings.find((b) => b.id === pawn.job?.targetId) : undefined;
  if (station?.ingredientFresh) {
    dropFood(w, station, station.ingredientFresh, 'raw', 'staple');
    station.ingredientFresh = 0;
    station.cookingProgress = 0;
    station.reservedBy = undefined;
  }
  if (pawn.carrying) {
    drop(w, pawn, pawn.carrying.resource, pawn.carrying.quantity, pawn.carrying.foodType);
    pawn.carrying = null;
  }
  pawn.x = Math.round(pawn.x);
  pawn.y = Math.round(pawn.y);
  pawn.job = null;
  reservations.release(pawn.id);
}
export function advanceJob(
  w: World,
  pawn: Pawn,
  reservations: Reservations,
  grid: Uint8Array,
  sheltered: Set<number>,
): boolean {
  const job = pawn.job;
  if (!job) return false;
  const finish = () => {
    pawn.job = null;
    reservations.release(pawn.id);
  };
  const cancel = () => interruptJob(w, pawn, reservations);
  const node = w.nodes.find((n) => n.id === job.targetId);
  const bp = w.blueprints.find((b) => b.id === job.targetId);
  const crop = w.crops.find((c) => c.id === job.targetId);
  const building = w.buildings.find((b) => b.id === job.targetId);
  const weatherWork =
    w.weather === 'clear' ||
    (job.kind !== 'chop' && job.kind !== 'gather' && job.kind !== 'harvest' && job.kind !== 'sow')
      ? 1
      : w.weather === 'rain'
        ? 0.82
        : 0.65;
  if (
    (['build', 'deliver'].includes(job.kind) && !bp) ||
    (['chop', 'gather'].includes(job.kind) && !node) ||
    (job.kind === 'harvest' && !crop) ||
    (['cook', 'deconstruct'].includes(job.kind) && !building)
  ) {
    cancel();
    return false;
  }
  if (job.path.length) {
    const next = job.path[0]!;
    if (!grid[tileKey(w, next)]) {
      cancel();
      return false;
    }
    const dx = next.x - pawn.x,
      dy = next.y - pawn.y,
      length = Math.hypot(dx, dy);
    const step =
      TICK_SECONDS *
      (pawn.rest < 15 ? 1.4 : 2.5) *
      (pawn.illnessUntil && pawn.illnessUntil > w.tick ? 0.88 : 1);
    if (length <= step) {
      pawn.x = next.x;
      pawn.y = next.y;
      job.path.shift();
    } else {
      pawn.x += (dx / length) * step;
      pawn.y += (dy / length) * step;
    }
    return false;
  }
  if (job.phase === 'source') {
    const item = w.items.find((i) => i.id === job.sourceId);
    if (!item) {
      cancel();
      return false;
    }
    const amount = Math.min(
      job.amount ?? 12,
      item.resource === 'food' && foodType(item) === 'raw' ? freshPoints(item) : item.quantity,
      bp ? BUILDINGS[bp.kind].cost - bp.delivered : 12,
    );
    if (amount <= 0) {
      cancel();
      return false;
    }
    const path = findPath(
      w,
      pawn,
      job.destination,
      ['deliver', 'cook', 'haul'].includes(job.kind),
      grid,
    );
    if (path === null) {
      cancel();
      return false;
    }
    pawn.carrying = {
      resource: item.resource,
      quantity: amount,
      foodType: foodType(item),
      foodKind: item.foodKind,
    };
    item.quantity -= amount;
    if (item.resource === 'food' && foodType(item) === 'raw') {
      item.freshPoints = Math.max(0, freshPoints(item) - amount);
      item.quantity = Math.max(0, Math.round(freshPoints(item) + spoiledPoints(item)));
    }
    if (!item.quantity) {
      w.items = w.items.filter((i) => i.id !== item.id);
      grid[tileKey(w, item)] = 1;
    }
    job.path = path;
    job.phase = 'target';
    return false;
  }
  job.progress += TICK_SECONDS;
  switch (job.kind) {
    case 'move':
      finish();
      break;
    case 'chop':
    case 'gather': {
      if (!node) break;
      node.work +=
        TICK_SECONDS * (1 + pawn.skills.plants * 0.06) * (pawn.productivity ?? 1) * weatherWork;
      if (node.work >= NODES[node.kind].work) {
        const def = NODES[node.kind];
        drop(
          w,
          node,
          def.resource,
          def.yield,
          'raw',
          node.kind === 'berries' ? 'berries' : 'staple',
        );
        w.nodes = w.nodes.filter((n) => n.id !== node.id);
        emit(w, `${pawn.name} gathered ${def.yield} ${def.resource}.`, 'success');
        finish();
        return true;
      }
      break;
    }
    case 'sow': {
      const key = tileKey(w, job.destination);
      if (w.growingZones.includes(key) && !w.crops.some((c) => sameTile(c, job.destination))) {
        w.crops.push({
          id: nextId(w, 'crop'),
          x: job.destination.x,
          y: job.destination.y,
          kind: 'grain',
          growth: 0,
        });
        emit(w, `${pawn.name} sowed a grain crop.`, 'info');
      }
      finish();
      return true;
    }
    case 'harvest': {
      if (!crop) break;
      crop.growth +=
        (TICK_SECONDS * (1 + pawn.skills.plants * 0.04) * (pawn.productivity ?? 1) * weatherWork) /
        3;
      if (crop.growth >= 1.25) {
        dropFood(w, crop, 8, 'raw', 'staple');
        grid[tileKey(w, crop)] = 0;
        w.crops = w.crops.filter((c) => c.id !== crop.id);
        emit(w, `${pawn.name} harvested a grain crop.`, 'success');
        finish();
        return true;
      }
      break;
    }
    case 'haul': {
      if (pawn.carrying) {
        drop(w, job.destination, pawn.carrying.resource, pawn.carrying.quantity);
        grid[tileKey(w, job.destination)] = 0;
        pawn.carrying = null;
      }
      finish();
      break;
    }
    case 'deliver': {
      if (bp && pawn.carrying) {
        bp.delivered += pawn.carrying.quantity;
        pawn.carrying = null;
      }
      finish();
      break;
    }
    case 'build': {
      if (!bp) break;
      bp.work += TICK_SECONDS * (1 + pawn.skills.build * 0.06) * (pawn.productivity ?? 1);
      if (bp.work >= BUILDINGS[bp.kind].work) {
        // Never seal a moving colonist into a newly completed wall.
        if (BUILDINGS[bp.kind].blocks && w.pawns.some((p) => sameTile(p, bp))) break;
        w.buildings.push({ id: nextId(w, 'building'), x: bp.x, y: bp.y, kind: bp.kind });
        w.blueprints = w.blueprints.filter((b) => b.id !== bp.id);
        emit(w, `${pawn.name} completed a ${BUILDINGS[bp.kind].label.toLowerCase()}.`, 'success');
        finish();
        return true;
      }
      break;
    }
    case 'cook': {
      if (!building || building.kind !== 'cooking') break;
      building.reservedBy = pawn.id;
      if (pawn.carrying) {
        building.ingredientFresh = (building.ingredientFresh ?? 0) + pawn.carrying.quantity;
        pawn.carrying = null;
        if ((building.ingredientFresh ?? 0) < COOKING_INPUT) {
          const next = w.items.find(
            (i) =>
              i.resource === 'food' &&
              foodType(i) === 'raw' &&
              freshPoints(i) > 0 &&
              !isFoodSpoiled(w, i),
          );
          if (!next) {
            // Preserve the v0.3 dedicated-cook path for non-hungry colonies;
            // personal self-care still requires the full 100-point recipe.
            if (pawn.hunger > 35 && (building.ingredientFresh ?? 0) >= 4)
              building.cookingProgress = 7.5;
            else {
              cancel();
              break;
            }
          }
          if (next) {
            job.sourceId = next.id;
            job.phase = 'source';
            job.path = findPath(w, building, next, true, grid) ?? [];
            break;
          }
        }
      }
      const required = pawn.hunger > 35 ? 4 : COOKING_INPUT;
      if ((building.ingredientFresh ?? 0) >= required) {
        building.cookingProgress =
          (building.cookingProgress ?? 0) +
          TICK_SECONDS * (1 + pawn.skills.cook * 0.04) * (pawn.productivity ?? 1);
        if ((building.cookingProgress ?? 0) >= 8) {
          dropFood(w, building, 1, 'meal');
          building.ingredientFresh = 0;
          building.cookingProgress = 0;
          building.reservedBy = undefined;
          emit(
            w,
            `${pawn.name} prepared a simple meal (${COOKED_MEAL_POINTS} food points).`,
            'success',
          );
          finish();
          return true;
        }
      }
      break;
    }
    case 'separate': {
      const food = w.items.find((i) => i.id === job.sourceId);
      if (!food || food.resource !== 'food') {
        cancel();
        break;
      }
      if (job.progress >= 3) {
        const spoiled = spoiledPoints(food);
        if (spoiled > 0) dropWaste(w, food, spoiled);
        food.spoiledPoints = 0;
        food.spoiled = false;
        food.quantity = Math.max(1, Math.round(freshPoints(food)));
        emit(w, `${pawn.name} separated spoiled food into physical waste.`, 'info');
        finish();
        return true;
      }
      break;
    }
    case 'deconstruct': {
      if (!building) break;
      job.progress += TICK_SECONDS * (1 + pawn.skills.build * 0.06) * (pawn.productivity ?? 1);
      if (job.progress >= BUILDINGS[building.kind].work) {
        w.buildings = w.buildings.filter((b) => b.id !== building.id);
        drop(w, building, 'wood', Math.floor(BUILDINGS[building.kind].cost * 0.6));
        grid[tileKey(w, building)] = 0;
        emit(
          w,
          `${pawn.name} recovered materials from the ${BUILDINGS[building.kind].label.toLowerCase()}.`,
          'success',
        );
        finish();
        return true;
      }
      break;
    }
    case 'eat': {
      const food = w.items.find((i) => i.id === job.sourceId);
      if (!food || isFoodSpoiled(w, food)) {
        cancel();
        break;
      }
      if (job.progress >= 2) {
        food.quantity--;
        if (food.resource === 'food' && foodType(food) === 'raw')
          food.freshPoints = Math.max(0, freshPoints(food) - 1);
        if (!food.quantity) w.items = w.items.filter((i) => i.id !== food.id);
        pawn.hunger = Math.min(
          100,
          pawn.hunger +
            (foodType(food) === 'meal'
              ? COOKED_MEAL_POINTS
              : food.foodKind === 'berries' || pawn.hunger <= 10
                ? 65
                : 35),
        );
        pawn.moodBias = (pawn.moodBias ?? 0) + (foodType(food) === 'meal' ? 2 : -3);
        emit(w, `${pawn.name} stopped for a meal.`);
        finish();
      }
      break;
    }
    case 'sleep': {
      const bed = job.targetId ? w.buildings.find((b) => b.id === job.targetId) : undefined;
      const shelteredBed = !!bed && sheltered.has(tileKey(w, bed));
      if (bed && job.progress === TICK_SECONDS) {
        if (!bed.ownerId) bed.ownerId = pawn.id;
        else if (bed.ownerId !== pawn.id) {
          pawn.moodBias = (pawn.moodBias ?? 0) - 3;
          const owner = w.pawns.find((p) => p.id === bed.ownerId);
          if (owner) owner.moodBias = (owner.moodBias ?? 0) - 2;
        }
      }
      const own = !!bed && bed.ownerId === pawn.id;
      pawn.rest = Math.min(
        100,
        pawn.rest + TICK_SECONDS * (bed ? (own ? 5.2 : shelteredBed ? 4.2 : 3.2) : 1.3),
      );
      if (pawn.rest >= 95 || pawn.hunger < 18) finish();
      break;
    }
  }
  return false;
}
