import { it, expect, vi } from 'vitest';
import { flatWorld } from './fixtures';
import { Simulation } from '../../src/sim/simulation';
import { drop, dropFood, dropWaste, nextId, tileKey } from '../../src/sim/world';
import { reachableMeal } from '../../src/sim/selfcare';
import { findPath } from '../../src/sim/pathfinding';

it('observes three days of dense storage, farming, self-care and waste without item path walls', () => {
  const w = flatWorld();
  w.width = w.height = 20;
  w.terrain = Array(400).fill('soil');
  w.stockpiles = [];
  w.dumpZones = [];
  w.buildings.push({ id: nextId(w, 'building'), kind: 'cooking', x: 12, y: 8 });
  for (let y = 0; y < 20; y++)
    for (let x = 7; x <= 9; x++) {
      drop(w, { x, y }, y % 2 ? 'wood' : 'stone', 12);
      w.stockpiles.push(tileKey(w, { x, y }));
    }
  for (let x = 11; x <= 14; x++) w.stockpiles.push(tileKey(w, { x, y: 10 }));
  for (let y = 12; y <= 14; y++)
    for (let x = 12; x <= 14; x++) {
      w.growingZones.push(tileKey(w, { x, y }));
      w.crops.push({ id: nextId(w, 'crop'), kind: 'grain', growth: 1, x, y });
    }
  w.dumpZones.push(tileKey(w, { x: 18, y: 18 }));
  dropWaste(w, { x: 10, y: 10 }, 25);
  dropFood(w, { x: 12, y: 10 }, 100);
  dropFood(w, { x: 13, y: 10 }, 100);
  for (const [i, p] of w.pawns.entries()) {
    p.x = 3;
    p.y = 6 + i;
    p.hunger = 32 + i * 3;
    p.priorities = { plants: 2, haul: 3, build: 2, cook: 2 };
    w.buildings.push({ id: nextId(w, 'building'), kind: 'bed', x: 4, y: 6 + i });
    dropFood(w, { x: 11, y: 6 + i }, 1, 'meal');
  }
  w.blueprints.push({
    id: nextId(w, 'blueprint'),
    kind: 'bed',
    x: 15,
    y: 5,
    delivered: 0,
    work: 0,
  });
  const sim = new Simulation(w);
  const metrics = {
    mealsCreated: 0,
    mealsConsumed: 0,
    cookToEat: 0,
    personalStartsWithReadyMeal: 0,
    pathsFailed: {} as Record<string, number>,
    lowestHungerWithAccessibleMeal: w.pawns.map(() => 100),
    itemBoxed: 0,
    resourceCrossings: 0,
    separation: 0,
    harvested: 0,
    sowed: 0,
    maxItems: 0,
    mealConsumedIds: [] as string[],
    createdIds: [] as string[],
    reservationMismatch: 0,
    wasteExpired: 0,
    expiredPoints: 0,
    consumedPoints: 0,
  };
  const record = sim.diagnostics.record.bind(sim.diagnostics);
  vi.spyOn(sim.diagnostics, 'record').mockImplementation((world, type, data = {}) => {
    if (type === 'FOOD_CONSUMED')
      metrics.consumedPoints += data.values?.foodType === 'meal' ? 80 : 1;
    if (type === 'MEAL_CREATED') {
      metrics.mealsCreated++;
      metrics.createdIds.push(data.targetId!);
    }
    if (type === 'FOOD_CONSUMED' && data.values?.foodType === 'meal') {
      metrics.mealsConsumed++;
      metrics.mealConsumedIds.push(data.targetId!);
    }
    if (type === 'COOK_TO_EAT_TRANSITION') metrics.cookToEat++;
    if (type === 'FOOD_SEPARATED') metrics.separation++;
    if (type === 'JOB_COMPLETED' && data.jobType === 'harvest') metrics.harvested++;
    if (type === 'JOB_COMPLETED' && data.jobType === 'sow') metrics.sowed++;
    if (type === 'PATH_FAILED')
      metrics.pathsFailed[data.jobType ?? 'unknown'] =
        (metrics.pathsFailed[data.jobType ?? 'unknown'] ?? 0) + 1;
    if (type === 'FOOD_PLAN_COOK_SELECTED') {
      const pawn = w.pawns.find((p) => p.id === data.entityId)!;
      if (pawn.job?.personalFoodPlan && reachableMeal(w, pawn, sim.reservations))
        metrics.personalStartsWithReadyMeal++;
    }
    record(world, type, data);
  });
  const start = performance.now();
  for (let tick = 0; tick < 18000; tick++) {
    const positions = w.pawns.map((p) => tileKey(w, p));
    if (w.tick % 100 === 99)
      metrics.expiredPoints += w.items
        .filter((item) => item.resource === 'waste')
        .flatMap((item) => item.expiryBatches ?? [])
        .filter((batch) => batch.expiresAt <= w.tick + 1)
        .reduce((sum, batch) => sum + batch.quantity, 0);
    const expired =
      w.tick % 100 === 99
        ? w.items.filter(
            (i) =>
              i.resource === 'waste' && i.expiryBatches?.every((b) => b.expiresAt <= w.tick + 1),
          ).length
        : 0;
    sim.step();
    metrics.wasteExpired += expired;
    metrics.maxItems = Math.max(metrics.maxItems, w.items.length);
    w.pawns.forEach((pawn, i) => {
      if (
        tileKey(w, pawn) !== positions[i] &&
        w.items.some((item) => tileKey(w, item) === tileKey(w, pawn))
      )
        metrics.resourceCrossings++;
      if (tick % 10 === 0 && reachableMeal(w, pawn, sim.reservations))
        metrics.lowestHungerWithAccessibleMeal[i] = Math.min(
          metrics.lowestHungerWithAccessibleMeal[i]!,
          pawn.hunger,
        );
      if (tick % 100 === 0 && !findPath(w, pawn, { x: 1, y: 1 })) metrics.itemBoxed++;
      for (const key of pawn.job?.keys ?? [])
        if (sim.reservations.owner(key) !== pawn.id) metrics.reservationMismatch++;
    });
  }
  const finalPoints =
    [...w.items, ...w.pawns.flatMap((p) => (p.carrying ? [p.carrying] : []))]
      .filter((i) => i.resource === 'food' || i.resource === 'waste')
      .reduce((sum, i) => sum + (i.foodType === 'meal' ? 80 * i.quantity : i.quantity), 0) +
    w.buildings.reduce((sum, b) => sum + (b.ingredientFresh ?? 0), 0);
  const expectedPoints =
    465 +
    metrics.harvested * 50 -
    metrics.mealsCreated * 20 -
    metrics.consumedPoints -
    metrics.expiredPoints;
  expect(finalPoints).toBeCloseTo(expectedPoints, 6);
  console.log(
    'SELFCARE_LONG_RUN',
    JSON.stringify({
      ...metrics,
      elapsedMs: Math.round(performance.now() - start),
      finalHunger: w.pawns.map((p) => p.hunger),
      remainingMeals: w.items
        .filter((i) => i.foodType === 'meal')
        .reduce((n, i) => n + i.quantity, 0),
    }),
  );
  expect(metrics.mealsCreated).toBeGreaterThan(0);
  expect(metrics.mealsConsumed).toBeGreaterThan(3);
  expect(metrics.cookToEat).toBeGreaterThan(0);
  expect(metrics.personalStartsWithReadyMeal).toBe(0);
  expect(metrics.pathsFailed).toEqual({});
  expect(metrics.itemBoxed).toBe(0);
  expect(metrics.resourceCrossings).toBeGreaterThan(0);
  expect(metrics.reservationMismatch).toBe(0);
  expect(metrics.harvested).toBeGreaterThan(9);
  expect(metrics.sowed).toBeGreaterThan(9);
  expect(metrics.separation).toBeGreaterThan(0);
  expect(metrics.wasteExpired).toBeGreaterThan(0);
  expect(metrics.lowestHungerWithAccessibleMeal.every((h) => h > 0)).toBe(true);
  expect(new Set(metrics.mealConsumedIds).size).toBe(metrics.mealsConsumed);
  expect(metrics.mealsConsumed).toBeLessThanOrEqual(metrics.mealsCreated + 3);
});
