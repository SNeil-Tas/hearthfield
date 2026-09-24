import { ensureAgricultureTile } from '../../src/sim/agriculture';
import { describe, expect, it, vi } from 'vitest';
import { flatWorld } from './fixtures';
import { advanceJob, interruptJob } from '../../src/sim/jobs';
import { workCandidates } from '../../src/sim/job-board';
import { Simulation } from '../../src/sim/simulation';
import { navigationGrid } from '../../src/sim/pathfinding';
import { Reservations } from '../../src/sim/reservations';
import { decode, encode } from '../../src/persistence/serialization';
import { COOKING_INPUT, COOKED_MEAL_POINTS } from '../../src/sim/definitions';
import { CROPS } from '../../src/sim/agriculture';
import type { Job, World, Stack } from '../../src/sim/types';
import {
  advanceFoodSpoilage,
  compatibleStacks,
  depositStack,
  dropFood,
  dropStack,
  foodPoints,
  freshPoints,
  isFoodSpoiled,
  nextId,
  tileKey,
  usefulResourceTotal,
  validStorageTile,
} from '../../src/sim/world';

function runJob(w: World, job: Partial<Job>, steps = 1) {
  const pawn = w.pawns[0]!;
  pawn.job = {
    kind: 'haul',
    destination: { x: 5, y: 5 },
    phase: 'target',
    path: [],
    progress: 0,
    keys: [],
    ...job,
  };
  const reservations = new Reservations();
  for (let i = 0; i < steps; i++) advanceJob(w, pawn, reservations, navigationGrid(w));
  return pawn;
}
const raw = (quantity: number): Stack => ({ resource: 'food', foodType: 'raw', quantity });
const inventory = (w: World) =>
  w.items.reduce((n, i) => n + foodPoints(i), 0) +
  w.pawns.reduce((n, p) => n + (p.carrying ? foodPoints(p.carrying) : 0), 0) +
  w.buildings.reduce((n, b) => n + (b.ingredientFresh ?? 0), 0);

describe('physical food accounting', () => {
  it('harvests exactly once and excludes growing and mature crops from the HUD', () => {
    const w = flatWorld();
    const crop = { id: nextId(w, 'crop'), x: 5, y: 5, kind: 'grain' as const, growth: 1 };
    w.crops.push(crop);
    expect(usefulResourceTotal(w, 'food')).toBe(0);
    runJob(w, { kind: 'harvest', targetId: crop.id }, 30);
    expect(w.crops).toHaveLength(0);
    expect(inventory(w)).toBe(CROPS.grain.foodYield);
    runJob(w, { kind: 'harvest', targetId: crop.id }, 30);
    expect(inventory(w)).toBe(CROPS.grain.foodYield);
    expect(w.items).toHaveLength(2);
    expect(w.items.find((item) => item.resource === 'seed')).toMatchObject({
      seedType: 'grain',
      quantity: CROPS.grain.seedYield,
    });
  });

  it('rejects crop storage, merging and consolidation even with legacy zone overlap', () => {
    const w = flatWorld();
    const crop = { id: nextId(w, 'crop'), x: 5, y: 5, kind: 'grain' as const, growth: 0.5 };
    w.crops.push(crop);
    w.growingZones.push(tileKey(w, crop));
    w.stockpiles.push(tileKey(w, crop), tileKey(w, { x: 6, y: 5 }));
    expect(depositStack(w, crop, raw(25))).toBe(25);
    expect(w.items).toHaveLength(0);
    expect(compatibleStacks(crop as unknown as Stack, raw(25))).toBe(false);
    dropFood(w, crop, 60);
    dropFood(w, { x: 6, y: 5 }, 10);
    expect(
      workCandidates(w)
        .filter((c) => c.kind === 'haul')
        .every((c) => validStorageTile(w, c.destination)),
    ).toBe(true);
    expect(crop).toEqual({ id: crop.id, x: 5, y: 5, kind: 'grain', growth: 0.5 });
  });

  it('does not duplicate a legacy raw stack lacking explicit freshness during merging', () => {
    const w = flatWorld();
    w.stockpiles.push(tileKey(w, { x: 5, y: 5 }));
    w.items.push({ id: nextId(w, 'item'), x: 5, y: 5, ...raw(60) });
    expect(depositStack(w, { x: 5, y: 5 }, raw(20))).toBe(0);
    expect(inventory(w)).toBe(80); // Previously 100: incoming amount counted twice.
  });

  it.each(['haul', 'cook'] as const)(
    '%s pickup transfers optional-freshness stacks exactly once',
    (kind) => {
      const w = flatWorld();
      const station = { id: nextId(w, 'building'), x: 5, y: 5, kind: 'cooking' as const };
      w.buildings.push(station);
      w.items.push({ id: nextId(w, 'item'), x: 4, y: 5, ...raw(50), spoilsAt: 900 });
      const pawn = runJob(w, {
        kind,
        sourceId: w.items[0]!.id,
        targetId: kind === 'cook' ? station.id : undefined,
        phase: 'source',
        amount: 10,
      });
      expect(inventory(w)).toBe(50);
      expect(pawn.carrying?.quantity).toBe(10);
      expect(pawn.carrying?.spoilsAt).toBe(900);
      expect(w.items[0]!.quantity).toBe(40);
      interruptJob(w, pawn, new Reservations());
      expect(inventory(w)).toBe(50);
    },
  );

  it('preserves fractional fresh/spoiled quantities and meal expiry on interrupted ground drops', () => {
    const w = flatWorld();
    const pawn = w.pawns[0]!;
    pawn.carrying = { ...raw(10), freshPoints: 7.25, spoiledPoints: 2.75, spoilsAt: 500 };
    interruptJob(w, pawn, new Reservations());
    expect(inventory(w)).toBe(7.25);
    expect(w.items[0]!.spoiledPoints).toBe(2.75);
    expect(w.items[0]!.spoilsAt).toBe(500);
    pawn.carrying = { resource: 'food', foodType: 'meal', quantity: 1, spoilsAt: 400 };
    interruptJob(w, pawn, new Reservations());
    expect(w.items[1]!.spoilsAt).toBe(400);
    expect(pawn.carrying).toBeNull();
  });

  it('failed deposits retain cargo as one ground transfer without creating pseudo-storage', () => {
    const w = flatWorld();
    const crop = { id: nextId(w, 'crop'), x: 5, y: 5, kind: 'grain' as const, growth: 0.5 };
    w.crops.push(crop);
    w.stockpiles.push(tileKey(w, crop));
    w.pawns[0]!.carrying = raw(12.5);
    runJob(w, { destination: crop });
    expect(inventory(w)).toBe(12.5);
    expect(w.pawns[0]!.carrying).toBeNull();
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.x).toBe(w.pawns[0]!.x);
    expect(w.items[0]!.y).toBe(w.pawns[0]!.y);
    expect('quantity' in crop).toBe(false);
  });

  it('full storage returns the remainder and incompatible occupied storage is not selected', () => {
    const w = flatWorld();
    w.stockpiles.push(tileKey(w, { x: 5, y: 5 }));
    dropFood(w, { x: 5, y: 5 }, 95);
    expect(depositStack(w, { x: 5, y: 5 }, raw(10))).toBe(5);
    dropFood(w, { x: 4, y: 5 }, 10);
    expect(workCandidates(w).filter((c) => c.kind === 'haul')).toHaveLength(0);
    w.items[0]!.resource = 'wood';
    expect(workCandidates(w).filter((c) => c.kind === 'haul')).toHaveLength(0);
  });

  it('cooking delivery, interruption and repeated refunds preserve buffers exactly once', () => {
    const w = flatWorld();
    const station = {
      id: nextId(w, 'building'),
      x: 5,
      y: 5,
      kind: 'cooking' as const,
      ingredientFresh: 83,
    };
    w.buildings.push(station);
    w.pawns[0]!.carrying = raw(17);
    expect(usefulResourceTotal(w, 'food')).toBe(100);
    const pawn = runJob(w, { kind: 'cook', targetId: station.id });
    expect(usefulResourceTotal(w, 'food')).toBe(100);
    expect(pawn.carrying).toBeNull();
    interruptJob(w, pawn, new Reservations());
    interruptJob(w, pawn, new Reservations());
    expect(usefulResourceTotal(w, 'food')).toBe(100);
    expect(station.ingredientFresh).toBe(0);
  });

  it('returns a demolished station buffer once instead of destroying its ingredients', () => {
    const w = flatWorld();
    const station = {
      id: nextId(w, 'building'),
      x: 5,
      y: 5,
      kind: 'cooking' as const,
      ingredientFresh: 83,
      deconstructing: true,
    };
    w.buildings.push(station);
    runJob(w, { kind: 'deconstruct', targetId: station.id }, 500);
    expect(w.buildings).toHaveLength(0);
    expect(inventory(w)).toBe(83);
    expect(w.items.filter((i) => i.resource === 'food')).toHaveLength(1);
  });

  it('converts 100 raw to 80 meal points with an explicit 20-point recipe loss', () => {
    const w = flatWorld();
    const station = {
      id: nextId(w, 'building'),
      x: 5,
      y: 5,
      kind: 'cooking' as const,
      ingredientFresh: COOKING_INPUT,
    };
    w.buildings.push(station);
    runJob(w, { kind: 'cook', targetId: station.id }, 100);
    expect(inventory(w)).toBe(COOKED_MEAL_POINTS);
    expect(w.items).toHaveLength(1);
  });

  it.each([0.25, 1, 2])(
    'eats raw quantity %s without negative residue or double subtraction',
    (quantity) => {
      const w = flatWorld();
      w.items.push({ id: nextId(w, 'item'), x: 5, y: 5, ...raw(quantity) });
      runJob(w, { kind: 'eat', sourceId: w.items[0]!.id }, 30);
      expect(inventory(w)).toBe(Math.max(0, quantity - 1));
      expect(w.items.every((i) => i.quantity > 0)).toBe(true);
    },
  );

  it('eats a meal once and excludes expired meals before their waste conversion', () => {
    const w = flatWorld();
    dropFood(w, { x: 5, y: 5 }, 2, 'meal');
    runJob(w, { kind: 'eat', sourceId: w.items[0]!.id }, 30);
    expect(inventory(w)).toBe(80);
    w.tick = w.items[0]!.spoilsAt!;
    expect(usefulResourceTotal(w, 'food')).toBe(0);
    advanceFoodSpoilage(w, w.items[0]!);
    const waste = w.items[0]!;
    advanceFoodSpoilage(w, waste);
    expect(inventory(w)).toBe(0);
    expect(w.items.reduce((n, i) => n + i.quantity, 0)).toBe(80);
  });

  it('raw spoilage transfers a fractional amount out of usable food once per update', () => {
    const w = flatWorld();
    dropFood(w, { x: 5, y: 5 }, 100);
    advanceFoodSpoilage(w, w.items[0]!);
    expect(inventory(w) + w.items[0]!.spoiledPoints!).toBeCloseTo(100, 10);
    expect(freshPoints(w.items[0]!)).toBeLessThan(100);
    expect(w.items[0]!.quantity).toBe(100);
  });

  it('schema 6 load preserves quantities, releases orphan buffers and removes only overlapping storage designations', () => {
    const w = flatWorld();
    w.stockpiles = [65, 66];
    w.growingZones = [65];
    w.crops.push({ id: nextId(w, 'crop'), x: 5, y: 5, kind: 'grain', growth: 0.5 });
    dropFood(w, { x: 5, y: 5 }, 70.25);
    w.buildings.push({
      id: nextId(w, 'building'),
      x: 8,
      y: 5,
      kind: 'cooking',
      ingredientFresh: 20,
    });
    w.pawns[0]!.carrying = { ...raw(4.75), spoilsAt: 800 };
    const saved = encode(w);
    expect(saved.version).toBe(6);
    const loaded = decode(saved).world;
    expect(inventory(loaded)).toBe(95);
    expect(loaded.stockpiles).toEqual([66]);
    expect(loaded.crops).toEqual(w.crops);
    expect(inventory(decode(encode(loaded)).world)).toBe(95);
  });

  it('reconciles ten days of three-colonist bounded farming, hauling, cooking, eating and spoilage', () => {
    const w = flatWorld();
    w.dumpZones = [tileKey(w, { x: 10, y: 10 })];
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    w.stockpiles = [tileKey(w, { x: 7, y: 6 }), tileKey(w, { x: 8, y: 6 })];
    // A 35-tile established field replaces the old nine-tile rapid-growth fixture.
    w.terrain[11 * w.width + 11] = 'water';
    for (let y = 5; y <= 11; y++)
      for (let x = 1; x <= 5; x++) {
        w.growingZones.push(tileKey(w, { x, y }));
        w.crops.push({ id: nextId(w, 'crop'), x, y, kind: 'grain', growth: 1 });
      }
    for (const p of w.pawns) {
      p.priorities = { plants: 2, haul: 3, cook: 1, build: 0 };
      p.hunger = 25;
    }
    for (const key of w.growingZones) ensureAgricultureTile(w, key, 'grain');
    const sim = new Simulation(w);
    let harvested = 0,
      consumed = 0,
      spoiled = 0,
      conversionLoss = 0,
      cooked = 0,
      maxError = 0,
      maxFood = 0;
    const record = sim.diagnostics.record.bind(sim.diagnostics);
    vi.spyOn(sim.diagnostics, 'record').mockImplementation((world, type, data = {}) => {
      if (type === 'CROP_HARVEST') harvested += Number(data.values!.produced);
      if (type === 'FOOD_CONSUMED') consumed += Number(data.values!.consumedPoints);
      if (type === 'FOOD_SPOILED') spoiled += Number(data.values!.spoiled);
      if (type === 'COOKING_COMPLETED') {
        conversionLoss += Number(data.values!.conversionLoss);
        cooked++;
      }
      if (type === 'RESOURCE_DEPOSIT' && Number(data.values!.accepted) > 0)
        expect(data.values!.validStorage).toBe(true);
      record(world, type, data);
    });
    for (let tick = 0; tick < 60000; tick++) {
      sim.step();
      const physical = inventory(w);
      maxFood = Math.max(maxFood, physical);
      maxError = Math.max(
        maxError,
        Math.abs(physical - (harvested - consumed - spoiled - conversionLoss)),
      );
      expect(maxError).toBeLessThan(1e-5);
      if (tick % 100 === 0) {
        expect(w.crops.every((c) => !('quantity' in c) && !('resource' in c))).toBe(true);
        expect(w.items.every((i) => Number.isFinite(i.quantity) && i.quantity > 0)).toBe(true);
        const expiredPending =
          w.items
            .filter((i) => i.foodType === 'meal' && isFoodSpoiled(w, i))
            .reduce((n, i) => n + foodPoints(i), 0) +
          w.pawns.reduce(
            (n, p) =>
              n +
              (p.carrying?.foodType === 'meal' && isFoodSpoiled(w, p.carrying)
                ? foodPoints(p.carrying)
                : 0),
            0,
          );
        expect(usefulResourceTotal(w, 'food')).toBeCloseTo(physical - expiredPending, 5);
      }
    }
    expect(harvested).toBeGreaterThan(450);
    expect(consumed).toBeGreaterThan(240);
    expect(cooked).toBeGreaterThan(3);
    expect(spoiled).toBeGreaterThan(0);
    expect(maxFood).toBeLessThanOrEqual(harvested);
    expect(w.pawns.every((p) => p.health > 0)).toBe(true);
    console.log(
      'FOOD_ACCOUNTING_10_DAYS',
      JSON.stringify({
        harvested,
        consumed,
        spoiled,
        conversionLoss,
        cooked,
        maxError,
        maxFood,
        finalFood: inventory(w),
        hunger: w.pawns.map((p) => p.hunger),
      }),
    );
  }, 30000);
});
