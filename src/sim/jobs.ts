import { isRoomBoundary, roomTopology } from './topology';
import { exposedFieldWorkMultiplier } from './weather';
import { BUILDINGS, NODES, SPOILED_FOOD_LIFETIME, TICK_SECONDS } from './definitions';
import {
  CROPS,
  PLANTING_WORK_SECONDS,
  HARVEST_WORK_SECONDS,
  WATERING_WORK_SECONDS,
  FERTILIZING_WORK_SECONDS,
  applyWatering,
  applyFertilizer,
  agricultureAt,
  dropSeed,
} from './agriculture';
import { emit } from './events';
import { findPath } from './pathfinding';
import { Reservations } from './reservations';
import type { Pawn, World } from './types';
import {
  drop,
  dropFood,
  dropStack,
  addSpoiledFood,
  foodType,
  freshPoints,
  spoiledPoints,
  nextId,
  sameTile,
  tileKey,
  isFoodSpoiled,
  requiresFoodSeparation,
  takeExpiryBatches,
  effectiveCarryCapacity,
  validStorageTile,
  depositStack,
} from './world';
import { COOKED_MEAL_POINTS, COOKING_INPUT } from './definitions';
import { DiagnosticLog, point } from './diagnostics';

export function interruptJob(
  w: World,
  pawn: Pawn,
  reservations: Reservations,
  diagnostics?: DiagnosticLog,
  reason = 'interrupted',
) {
  diagnostics?.record(w, 'JOB_INTERRUPTED', {
    entityId: pawn.id,
    entityName: pawn.name,
    targetId: pawn.job?.targetId,
    jobType: pawn.job?.kind,
    phase: pawn.job?.phase,
    position: point(pawn),
    reason,
  });
  const station =
    pawn.job?.kind === 'cook' ? w.buildings.find((b) => b.id === pawn.job?.targetId) : undefined;
  if (station) {
    if (station.ingredientFresh) {
      dropFood(w, station, station.ingredientFresh, 'raw', 'staple');
      station.ingredientFresh = 0;
      station.cookingProgress = 0;
    }
    station.reservedBy = undefined;
    diagnostics?.record(w, 'COOKING_STATION_RELEASED', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: station.id,
      jobType: 'cook',
      reason: 'job interrupted',
    });
  }
  if (pawn.carrying) {
    dropStack(w, pawn, pawn.carrying);
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
  _legacySheltered?: Set<number>,
  diagnostics?: DiagnosticLog,
): boolean {
  const job = pawn.job;
  if (!job) return false;
  const finish = () => {
    diagnostics?.record(w, 'JOB_COMPLETED', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: job.targetId,
      jobType: job.kind,
      phase: job.phase,
      position: point(pawn),
    });
    pawn.job = null;
    reservations.release(pawn.id);
  };
  const cancel = (reason = 'interrupted') =>
    interruptJob(w, pawn, reservations, diagnostics, reason);
  const node = w.nodes.find((n) => n.id === job.targetId);
  const bp = w.blueprints.find((b) => b.id === job.targetId);
  const crop = w.crops.find((c) => c.id === job.targetId);
  const building = w.buildings.find((b) => b.id === job.targetId);
  const soil = agricultureAt(w, job.destination);
  const weatherWork = ['chop', 'gather', 'harvest', 'sow', 'water', 'fertilize'].includes(job.kind)
    ? exposedFieldWorkMultiplier(w, pawn)
    : 1;
  if (
    (['build', 'deliver'].includes(job.kind) && !bp) ||
    (['chop', 'gather'].includes(job.kind) && !node) ||
    (job.kind === 'harvest' && !crop) ||
    (['sow', 'water', 'fertilize'].includes(job.kind) && !soil) ||
    (['cook', 'deconstruct'].includes(job.kind) && !building)
  ) {
    cancel('job target missing');
    return false;
  }
  if (job.path.length) {
    const next = job.path[0]!;
    if (!grid[tileKey(w, next)]) {
      cancel('route invalidated by occupancy');
      diagnostics?.record(w, 'PATH_FAILED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: job.targetId,
        jobType: job.kind,
        reason: 'route invalidated by occupancy',
        position: point(pawn),
      });
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
  if (job.progress === 0 && !job.separationProgress)
    diagnostics?.record(w, 'JOB_STARTED', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: job.targetId,
      jobType: job.kind,
      phase: job.phase,
      position: point(pawn),
    });

  if (job.phase === 'source') {
    if (job.kind === 'water' && job.sourceKind === 'water') {
      const path = findPath(w, pawn, job.destination, false, grid);
      if (path === null) {
        cancel('field unreachable after collecting water');
        return false;
      }
      job.waterAmount = 1;
      job.path = path;
      job.phase = 'target';
      diagnostics?.record(w, 'AGRICULTURAL_WATER_ACQUIRED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: job.targetId,
        jobType: 'water',
        phase: 'target',
        position: point(pawn),
      });
      return false;
    }
    const item = w.items.find((i) => i.id === job.sourceId);
    if (!item) {
      cancel('source item missing');
      return false;
    }
    if (job.kind === 'separate') {
      job.destination = { x: item.x, y: item.y };
      job.phase = 'target';
      return false;
    }
    if (job.kind === 'cook' && requiresFoodSeparation(item)) {
      if (!job.separationProgress)
        diagnostics?.record(w, 'FOOD_SEPARATION_REQUIRED', {
          entityId: pawn.id,
          targetId: item.id,
          jobType: 'cook',
          reason: 'required ingredient substep',
        });
      job.separationProgress = (job.separationProgress ?? 0) + TICK_SECONDS;
      if (job.separationProgress < 3) return false;
      const spoiled = spoiledPoints(item);
      addSpoiledFood(w, item, spoiled, w.tick + SPOILED_FOOD_LIFETIME);
      item.spoiledPoints = 0;
      item.quantity = freshPoints(item);
      item.spoiled = false;
      pawn.rotHandledUntil = w.tick + 600;
      pawn.rotHandledPenalty = Math.min(4, Math.max(2, pawn.rotHandledPenalty ?? 0));
      diagnostics?.record(w, 'FOOD_SEPARATED', {
        entityId: pawn.id,
        targetId: item.id,
        jobType: 'cook',
        values: { fresh: freshPoints(item), spoiled },
      });
      job.separationProgress = 0;
    }
    const recipeRemaining =
      job.kind === 'cook' && building
        ? Math.max(0, COOKING_INPUT - (building.ingredientFresh ?? 0))
        : 12;
    const sourceFresh = freshPoints(item);
    const amount = Math.min(
      job.amount ?? effectiveCarryCapacity(item.resource),
      effectiveCarryCapacity(item.resource),
      item.resource === 'food' && foodType(item) === 'raw' ? freshPoints(item) : item.quantity,
      job.kind === 'cook' ? recipeRemaining : bp ? BUILDINGS[bp.kind].cost - bp.delivered : 12,
      recipeRemaining,
    );
    if (amount <= 0) {
      cancel('source amount unavailable');
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
      cancel('source unreachable');
      diagnostics?.record(w, 'PATH_FAILED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: item.id,
        jobType: job.kind,
        reason: 'source unreachable',
        position: point(pawn),
      });
      return false;
    }
    pawn.carrying = {
      resource: item.resource,
      quantity: amount,
      ...(item.resource === 'food' ? { foodType: foodType(item), foodKind: item.foodKind } : {}),
      ...(item.resource === 'seed' ? { seedType: item.seedType } : {}),
      expiryBatches: item.expiryBatches,
      spoilsAt: item.spoilsAt,
      ...(item.resource === 'food' && foodType(item) === 'raw'
        ? { freshPoints: amount, spoiledPoints: 0 }
        : {}),
    };
    if (item.resource === 'waste') pawn.carrying.expiryBatches = takeExpiryBatches(item, amount);
    diagnostics?.record(w, 'ITEM_PICKED_UP', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: item.id,
      jobType: job.kind,
      position: point(pawn),
      values: { quantity: amount, resource: item.resource },
    });
    if (item.resource === 'seed')
      diagnostics?.record(w, 'SEED_ACQUIRED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: item.id,
        jobType: job.kind,
        position: point(pawn),
        values: { crop: item.seedType ?? null, quantity: amount },
      });
    diagnostics?.record(w, 'RESOURCE_PICKUP_AMOUNT', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: item.id,
      jobType: job.kind,
      position: point(pawn),
      values: {
        sourceAmount: item.quantity,
        capacity: effectiveCarryCapacity(item.resource),
        recipeRemaining,
        actualPickup: amount,
      },
    });
    if (item.resource === 'waste')
      diagnostics?.record(w, 'SPOILED_FOOD_PICKED_UP', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: item.id,
        jobType: job.kind,
        position: point(pawn),
        values: { quantity: amount },
      });
    item.quantity -= amount;
    if (item.resource === 'food' && foodType(item) === 'raw') {
      item.freshPoints = Math.max(0, sourceFresh - amount);
      item.quantity = freshPoints(item) + spoiledPoints(item);
    }
    if (item.quantity <= 1e-6) w.items = w.items.filter((i) => i.id !== item.id);
    job.path = path;
    diagnostics?.record(w, 'JOB_PHASE_CHANGED', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: job.targetId,
      jobType: job.kind,
      phase: 'target',
      position: point(pawn),
    });
    job.phase = 'target';
    return false;
  }

  job.progress += TICK_SECONDS;
  const plantWork =
    job.progress * (1 + pawn.skills.plants * 0.04) * (pawn.productivity ?? 1) * weatherWork;
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
        if (node.kind === 'berries') {
          dropSeed(w, node, 'berry', 1);
          diagnostics?.record(w, 'WILD_SEED_ACQUIRED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: node.id,
            jobType: 'gather',
            position: point(node),
            values: { crop: 'berry', quantity: 1 },
          });
        }
        w.nodes = w.nodes.filter((n) => n.id !== node.id);
        emit(w, `${pawn.name} gathered ${def.yield} ${def.resource}.`, 'success');
        finish();
        return true;
      }
      break;
    }
    case 'sow': {
      if (plantWork < PLANTING_WORK_SECONDS) break;
      const key = tileKey(w, job.destination);
      const currentSoil = agricultureAt(w, key);
      const seeds = pawn.carrying;
      if (
        !currentSoil ||
        !w.growingZones.includes(key) ||
        w.crops.some((c) => sameTile(c, job.destination)) ||
        seeds?.resource !== 'seed' ||
        seeds.seedType !== currentSoil.cropType
      ) {
        cancel('planting precondition changed');
        return false;
      }
      const def = CROPS[currentSoil.cropType];
      if (seeds.quantity < def.seedCost) {
        cancel('insufficient seed at planting');
        return false;
      }
      seeds.quantity -= def.seedCost;
      if (seeds.quantity > 0) dropStack(w, pawn, seeds);
      pawn.carrying = null;
      const planted = {
        id: nextId(w, 'crop'),
        x: job.destination.x,
        y: job.destination.y,
        kind: currentSoil.cropType,
        growth: 0,
      } as const;
      w.crops.push(planted);
      diagnostics?.record(w, 'PLANTING_COMPLETED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: planted.id,
        jobType: 'sow',
        position: point(planted),
        values: {
          crop: planted.kind,
          seedConsumed: def.seedCost,
          moisture: currentSoil.moisture,
          nutrients: currentSoil.nutrients,
        },
      });
      emit(w, `${pawn.name} planted ${def.name.toLowerCase()}.`, 'info');
      finish();
      return true;
    }
    case 'water': {
      if (plantWork < WATERING_WORK_SECONDS) break;
      if (!job.waterAmount || !soil) {
        cancel('water was not collected');
        return false;
      }
      const watered = applyWatering(w, job.destination, diagnostics, pawn.id);
      diagnostics?.record(w, 'WATERING_COMPLETED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: job.targetId,
        jobType: 'water',
        position: point(job.destination),
        values: { tiles: watered },
      });
      finish();
      return true;
    }
    case 'fertilize': {
      if (plantWork < FERTILIZING_WORK_SECONDS) break;
      if (!soil || pawn.carrying?.resource !== 'fertilizer' || pawn.carrying.quantity < 1) {
        cancel('fertilizer unavailable at application');
        return false;
      }
      applyFertilizer(w, job.destination, diagnostics, pawn.id);
      pawn.carrying.quantity -= 1;
      if (pawn.carrying.quantity > 0) dropStack(w, pawn, pawn.carrying);
      pawn.carrying = null;
      finish();
      return true;
    }
    case 'harvest': {
      if (!crop || crop.growth < 1 || plantWork < HARVEST_WORK_SECONDS) break;
      const def = CROPS[crop.kind];
      dropFood(w, crop, def.foodYield, 'raw', 'staple');
      const foodId = w.items[w.items.length - 1]?.id;
      dropSeed(w, crop, crop.kind, def.seedYield);
      diagnostics?.record(w, 'CROP_HARVEST', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: crop.id,
        jobType: 'harvest',
        position: point(crop),
        values: {
          crop: crop.kind,
          foodYield: def.foodYield,
          seedYield: def.seedYield,
          foodItemId: foodId ?? null,
          produced: def.foodYield,
          createdItemId: foodId ?? null,
        },
      });
      diagnostics?.record(w, 'CROP_FOOD_YIELD', {
        entityId: pawn.id,
        targetId: crop.id,
        values: { crop: crop.kind, produced: def.foodYield },
      });
      diagnostics?.record(w, 'CROP_SEED_YIELD', {
        entityId: pawn.id,
        targetId: crop.id,
        values: { crop: crop.kind, produced: def.seedYield },
      });
      w.crops = w.crops.filter((c) => c.id !== crop.id);
      emit(w, `${pawn.name} harvested ${def.name.toLowerCase()}.`, 'success');
      finish();
      return true;
    }
    case 'haul': {
      if (pawn.carrying) {
        if (pawn.carrying.resource === 'waste') dropStack(w, job.destination, pawn.carrying);
        else {
          const before = pawn.carrying.quantity;
          const remaining = depositStack(w, job.destination, pawn.carrying);
          diagnostics?.record(w, 'RESOURCE_DEPOSIT', {
            entityId: pawn.id,
            jobType: 'haul',
            position: point(job.destination),
            values: {
              requested: before,
              accepted: before - remaining,
              remaining,
              validStorage: validStorageTile(w, job.destination),
            },
          });
          if (remaining > 1e-6) {
            const fraction = remaining / before;
            dropStack(w, pawn, {
              ...pawn.carrying,
              quantity: remaining,
              ...(pawn.carrying.resource === 'food' && foodType(pawn.carrying) === 'raw'
                ? {
                    freshPoints: freshPoints(pawn.carrying) * fraction,
                    spoiledPoints: spoiledPoints(pawn.carrying) * fraction,
                  }
                : {}),
            });
          }
        }
        diagnostics?.record(w, 'ITEM_DROPPED', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: `${job.destination.x},${job.destination.y}`,
          jobType: job.kind,
          position: point(job.destination),
          values: { quantity: pawn.carrying.quantity, resource: pawn.carrying.resource },
        });
        if (pawn.carrying.resource === 'waste')
          diagnostics?.record(w, 'SPOILED_FOOD_DROPPED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: `${job.destination.x},${job.destination.y}`,
            jobType: job.kind,
            position: point(job.destination),
            values: { quantity: pawn.carrying.quantity },
          });
        pawn.carrying = null;
      }
      finish();
      break;
    }
    case 'deliver': {
      if (bp && pawn.carrying) {
        bp.delivered += pawn.carrying.quantity;
        diagnostics?.record(w, 'ITEM_DELIVERED', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: bp.id,
          jobType: job.kind,
          position: point(bp),
          values: { quantity: pawn.carrying.quantity, resource: pawn.carrying.resource },
        });
        pawn.carrying = null;
      }
      finish();
      break;
    }
    case 'build': {
      if (!bp) break;
      bp.work += TICK_SECONDS * (1 + pawn.skills.build * 0.06) * (pawn.productivity ?? 1);
      if (bp.work >= BUILDINGS[bp.kind].work) {
        if (BUILDINGS[bp.kind].blocks && w.pawns.some((p) => sameTile(p, bp))) break;
        w.buildings.push({ id: nextId(w, 'building'), x: bp.x, y: bp.y, kind: bp.kind });
        w.blueprints = w.blueprints.filter((b) => b.id !== bp.id);
        if (isRoomBoundary(bp.kind)) roomTopology(w).invalidate(`completed ${bp.kind}`);
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
        const bufferBefore = building.ingredientFresh ?? 0;
        const delivered = Math.min(
          pawn.carrying.quantity,
          Math.max(0, COOKING_INPUT - bufferBefore),
        );
        if (delivered < pawn.carrying.quantity) {
          dropFood(w, pawn, pawn.carrying.quantity - delivered, 'raw', 'staple');
          pawn.carrying.quantity = delivered;
        }
        building.ingredientFresh = bufferBefore + delivered;
        pawn.carrying = null;
        diagnostics?.record(w, 'ITEM_DELIVERED_TO_BUFFER', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: building.id,
          jobType: job.kind,
          position: point(building),
          values: {
            transactionId: job.cookTransactionId ?? `${pawn.id}:${building.id}`,
            bufferBefore,
            delivered,
            bufferAfter: building.ingredientFresh,
            recipeRequirement: COOKING_INPUT,
            currentSourceId: job.sourceId ?? null,
          },
        });
        if (building.ingredientFresh >= COOKING_INPUT)
          diagnostics?.record(w, 'COOK_RECIPE_READY', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: building.id,
            jobType: 'cook',
            position: point(building),
            values: {
              transactionId: job.cookTransactionId ?? `${pawn.id}:${building.id}`,
              bufferFresh: building.ingredientFresh,
              recipeRequirement: COOKING_INPUT,
              nextAction: 'begin cooking',
            },
          });
      }
      const required = COOKING_INPUT;
      if ((building.ingredientFresh ?? 0) < required) {
        const previousSourceId = job.sourceId;
        const eligibleSources = w.items.filter(
          (i) =>
            i.resource === 'food' &&
            foodType(i) === 'raw' &&
            freshPoints(i) >= 1 &&
            reservations.available([i.id], pawn.id),
        );
        const orderedSources =
          job.amount !== undefined
            ? eligibleSources
            : [...eligibleSources].sort(
                (a, b) =>
                  Math.abs(a.x - building.x) +
                  Math.abs(a.y - building.y) * 0.5 -
                  freshPoints(a) * 2 -
                  (Math.abs(b.x - building.x) +
                    Math.abs(b.y - building.y) * 0.5 -
                    freshPoints(b) * 2),
              );
        const next = orderedSources.find((i) => findPath(w, pawn, i, true, grid) !== null);
        if (next && reservations.claim([next.id], pawn.id)) {
          if (next.id !== previousSourceId) {
            if (previousSourceId) reservations.releaseKey(previousSourceId, pawn.id);
            job.keys = job.keys.filter((key) => key !== previousSourceId);
            job.keys.push(next.id);
          }
          job.sourceId = next.id;
          job.phase = 'source';
          job.waitingForSource = false;
          job.path = findPath(w, pawn, next, true, grid)!;
          diagnostics?.record(w, 'COOK_SOURCE_SWITCHED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: building.id,
            jobType: 'cook',
            position: point(building),
            values: {
              transactionId: job.cookTransactionId ?? `${pawn.id}:${building.id}`,
              previousSourceId: previousSourceId ?? null,
              nextSourceId: next.id,
              sourceAction: next.id === previousSourceId ? 'same source' : 'new source',
              sourceFreshRemaining: freshPoints(next),
              bufferFresh: building.ingredientFresh ?? 0,
            },
          });
          break;
        }
        if (!next) {
          if (previousSourceId) {
            reservations.releaseKey(previousSourceId, pawn.id);
            job.keys = job.keys.filter((key) => key !== previousSourceId);
          }
          job.sourceId = undefined;
          if (!job.waitingForSource)
            diagnostics?.record(w, 'COOK_SOURCE_EXHAUSTED', {
              entityId: pawn.id,
              entityName: pawn.name,
              targetId: building.id,
              jobType: 'cook',
              position: point(building),
              values: {
                transactionId: job.cookTransactionId ?? `${pawn.id}:${building.id}`,
                sourceId: previousSourceId ?? null,
                bufferFresh: building.ingredientFresh ?? 0,
                recipeRequirement: required,
                nextAction: 'acquire new source',
              },
            });
          }
          job.waitingForSource = true;
          if (
            pawn.hunger < 18 &&
            w.items.some(
              (item) =>
                item.resource === 'food' &&
                (foodType(item) === 'meal' || item.foodKind === 'berries') &&
                !isFoodSpoiled(w, item) &&
                item.quantity > 1e-6,
            )
          ) {
            interruptJob(w, pawn, reservations, diagnostics, 'critical hunger fallback food');
            return true;
          }
        }
        break;
      }
      if (job.waitingForSource) {
        job.waitingForSource = false;
        diagnostics?.record(w, 'COOK_RECIPE_READY', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: building.id,
          jobType: 'cook',
          position: point(building),
          values: {
            transactionId: job.cookTransactionId ?? `${pawn.id}:${building.id}`,
            bufferFresh: building.ingredientFresh ?? 0,
            recipeRequirement: required,
            nextAction: 'begin cooking',
          },
        });
      }
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
          diagnostics?.record(w, 'COOKING_COMPLETED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: building.id,
            jobType: 'cook',
            position: point(building),
            values: {
              mealPoints: COOKED_MEAL_POINTS,
              inputPoints: required,
              conversionLoss: required - COOKED_MEAL_POINTS,
            },
          });
          const meal = w.items[w.items.length - 1];
          if (meal?.foodType === 'meal')
            diagnostics?.record(w, 'MEAL_CREATED', {
              entityId: pawn.id,
              entityName: pawn.name,
              targetId: meal.id,
              jobType: 'cook',
              position: point(meal),
              values: { quantity: meal.quantity },
            });
          diagnostics?.record(w, 'COOKING_STATION_RELEASED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: building.id,
            jobType: 'cook',
            reason: 'cooking completed',
            position: point(building),
          });
          finish();
          if (job.personalFoodPlan && meal?.foodType === 'meal') {
            reservations.claim([meal.id], pawn.id);
            pawn.job = {
              kind: 'eat',
              sourceId: meal.id,
              destination: { x: meal.x, y: meal.y },
              phase: 'target',
              path: [],
              progress: 0,
              keys: [meal.id],
              personalFoodPlan: true,
              cookTransactionId: job.cookTransactionId,
            };
            diagnostics?.record(w, 'COOK_TO_EAT_TRANSITION', {
              entityId: pawn.id,
              targetId: meal.id,
              jobType: 'eat',
              values: { transactionId: job.cookTransactionId ?? '', createdMealId: meal.id },
            });
          }
          return true;
        }
      }
      break;
    }
    case 'separate': {
      const food = w.items.find((i) => i.id === job.sourceId);
      if (!food || food.resource !== 'food') {
        cancel('food missing during separation');
        break;
      }
      if (job.progress >= 3) {
        const spoiled = spoiledPoints(food);
        if (spoiled > 0) {
          addSpoiledFood(w, job.destination, spoiled, w.tick + SPOILED_FOOD_LIFETIME);
          diagnostics?.record(w, 'SPOILED_FOOD_CREATED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: food.id,
            jobType: 'separate',
            position: point(job.destination),
            values: { quantity: spoiled },
          });
        }
        food.spoiledPoints = 0;
        food.spoiled = false;
        food.quantity = freshPoints(food);
        if (food.quantity <= 1e-6) w.items = w.items.filter((item) => item.id !== food.id);
        pawn.rotHandledUntil = w.tick + 600;
        pawn.rotHandledPenalty = Math.min(4, Math.max(2, pawn.rotHandledPenalty ?? 0));
        diagnostics?.record(w, 'FOOD_SEPARATED', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: food.id,
          jobType: 'separate',
          position: point(job.destination),
          values: { fresh: freshPoints(food), spoiled },
        });
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
        for (const cook of w.pawns)
          if (cook.job?.kind === 'cook' && cook.job.targetId === building.id)
            interruptJob(w, cook, reservations, diagnostics, 'station deconstructed');
        if (building.ingredientFresh) {
          dropFood(w, building, building.ingredientFresh);
          building.ingredientFresh = 0;
        }
        w.buildings = w.buildings.filter((b) => b.id !== building.id);
        if (isRoomBoundary(building.kind))
          roomTopology(w).invalidate(`demolished ${building.kind}`);
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
        interruptJob(w, pawn, reservations, diagnostics, 'meal missing or spoiled');
        break;
      }
      if (job.progress >= 2) {
        const before = pawn.hunger;
        const freshBefore = freshPoints(food);
        const eaten = Math.min(1, food.quantity);
        food.quantity -= eaten;
        if (food.resource === 'food' && foodType(food) === 'raw')
          food.freshPoints = Math.max(0, freshBefore - eaten);
        if (food.quantity <= 1e-6) w.items = w.items.filter((i) => i.id !== food.id);
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
        diagnostics?.record(w, 'FOOD_CONSUMED', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: food.id,
          jobType: 'eat',
          position: point(pawn),
          values: {
            hungerBefore: before,
            hungerAfter: pawn.hunger,
            foodType: foodType(food),
            consumedPoints: eaten * (foodType(food) === 'meal' ? COOKED_MEAL_POINTS : 1),
          },
        });
        finish();
      }
      break;
    }
    case 'sleep': {
      const bed = job.targetId ? w.buildings.find((b) => b.id === job.targetId) : undefined;
      const shelteredBed = !!bed && roomTopology(w).isIndoors(bed);
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
        pawn.rest + TICK_SECONDS * (bed ? (own ? 5.2 : 4.2) * (shelteredBed ? 1 : 0.85) : 1.3),
      );
      if (pawn.rest >= 95 || pawn.hunger < 18) finish();
      break;
    }
  }
  return false;
}
