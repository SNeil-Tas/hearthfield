import { expect, it, vi } from 'vitest';
import { flatWorld } from '../sim/fixtures';
import { Simulation } from '../../src/sim/simulation';
import { ensureAgricultureTile } from '../../src/sim/agriculture';
import {
  foodPoints,
  isFoodSpoiled,
  nextId,
  tileKey,
  usefulResourceTotal,
} from '../../src/sim/world';

// Deliberately synchronized mature crops, no forage or fertilizer: a mass-ledger
// stress fixture, not an autonomous survival or agriculture-balance benchmark.
it('reconciles physical food at the 35-tile 16-day accounting scale', () => {
  const version = 'agriculture-schema-6';
  const w = flatWorld();
  w.width = w.height = 20;
  w.terrain = Array(400).fill('soil');
  w.terrain[15 * w.width + 7] = 'water';
  w.dumpZones = [tileKey(w, { x: 18, y: 18 })];
  for (let y = 8; y < 15; y++)
    for (let x = 2; x < 7; x++) {
      w.growingZones.push(tileKey(w, { x, y }));
      ensureAgricultureTile(w, tileKey(w, { x, y }), 'grain');
      w.crops.push({ id: nextId(w, 'crop'), x, y, kind: 'grain', growth: 1 });
    }
  for (let y = 8; y < 11; y++)
    for (let x = 10; x < 15; x++) w.stockpiles.push(tileKey(w, { x, y }));
  w.items.push(
    { id: nextId(w, 'item'), x: 10, y: 8, resource: 'wood', quantity: 12 },
    { id: nextId(w, 'item'), x: 11, y: 8, resource: 'stone', quantity: 12 },
  );
  w.buildings.push({ id: nextId(w, 'building'), x: 12, y: 5, kind: 'cooking' });
  for (const [i, p] of w.pawns.entries()) {
    p.priorities = { plants: 2, haul: 3, cook: 1, build: 0 };
    p.hunger = 70;
    w.buildings.push({ id: nextId(w, 'building'), x: 8 + i, y: 4, kind: 'bed' });
  }
  let harvested = 0,
    eaten = 0,
    conversionLoss = 0,
    wasteExpired = 0,
    maxError = 0,
    maxHud = 0,
    cooked = 0;
  const sim = new Simulation(w);
  const record = sim.diagnostics.record.bind(sim.diagnostics);
  vi.spyOn(sim.diagnostics, 'record').mockImplementation((world, type, data = {}) => {
    if (type === 'CROP_HARVEST') harvested += Number(data.values!.produced);
    if (type === 'FOOD_CONSUMED')
      eaten += data.values?.foodType === 'meal' ? 80 : Number(data.values?.consumedPoints ?? 1);
    if (type === 'COOKING_COMPLETED') {
      conversionLoss += 20;
      cooked++;
    }
    record(world, type, data);
  });
  for (let tick = 0; tick < 96000; tick++) {
    if (w.tick % 100 === 99)
      wasteExpired += w.items
        .filter((i) => i.resource === 'waste')
        .flatMap((i) => i.expiryBatches ?? [])
        .filter((b) => b.expiresAt <= w.tick + 1)
        .reduce((n, b) => n + b.quantity, 0);
    sim.step();
    const mass =
      [...w.items, ...w.pawns.flatMap((p) => (p.carrying ? [p.carrying] : []))].reduce(
        (n, i) =>
          n +
          (i.resource === 'food'
            ? i.foodType === 'meal'
              ? i.quantity * 80
              : i.quantity
            : i.resource === 'waste'
              ? i.quantity
              : 0),
        0,
      ) + w.buildings.reduce((n, b) => n + (b.ingredientFresh ?? 0), 0);
    maxError = Math.max(
      maxError,
      Math.abs(mass - (harvested - eaten - conversionLoss - wasteExpired)),
    );
    expect(maxError).toBeLessThan(1e-5);
    if (tick % 100 === 0) {
      maxHud = Math.max(maxHud, usefulResourceTotal(w, 'food'));
      expect(w.crops.every((c) => !('resource' in c) && !('quantity' in c))).toBe(true);
      expect(w.items.every((i) => Number.isFinite(i.quantity) && i.quantity > 0)).toBe(true);
    }
  }
  const expiredMealPoints = w.items
    .filter((i) => i.foodType === 'meal' && isFoodSpoiled(w, i))
    .reduce((n, i) => n + foodPoints(i), 0);
  console.log(
    'FOOD_ACCOUNTING_35_TILES_16_DAYS',
    JSON.stringify({
      version,
      harvested,
      eaten,
      cooked,
      conversionLoss,
      wasteExpired,
      maxError,
      maxHud,
      hud: usefulResourceTotal(w, 'food'),
      expiredMealPoints,
      foodStacks: w.items.filter((i) => i.resource === 'food').length,
      health: w.pawns.map((p) => p.health),
      hunger: w.pawns.map((p) => p.hunger),
    }),
  );
  expect(harvested).toBeGreaterThan(1750);
  expect(cooked).toBeGreaterThan(0);
  expect(eaten).toBeGreaterThan(240);
  expect(w.pawns.every((p) => p.health > 0)).toBe(true);
}, 600000);
