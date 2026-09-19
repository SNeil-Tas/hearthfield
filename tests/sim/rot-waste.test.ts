import { describe, expect, it } from 'vitest';
import { advanceJob, interruptJob } from '../../src/sim/jobs';
import { navigationGrid } from '../../src/sim/pathfinding';
import { updateNeeds } from '../../src/sim/needs';
import { Simulation } from '../../src/sim/simulation';
import {
  addSpoiledFood,
  advanceFoodSpoilage,
  advanceWasteDecay,
  drop,
  dropWaste,
  requiresFoodSeparation,
  tileKey,
  resourceTotal,
} from '../../src/sim/world';
import { nextId, freshPoints, spoiledPoints } from '../../src/sim/world';
import { workCandidates } from '../../src/sim/job-board';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { buildDebugReport } from '../../src/sim/diagnostics';
import { flatWorld } from './fixtures';
import type { Building } from '../../src/sim/types';

describe('v0.5 rot and waste systems', () => {
  it('uses an absolute ten-point separation threshold', () => {
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 0 })).toBe(false);
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 9 })).toBe(false);
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 10 })).toBe(false);
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 10.01 })).toBe(true);
  });

  it('physically separates spoiled points without losing fresh food', () => {
    const w = flatWorld();
    const pawn = w.pawns[0]!;
    const item = {
      id: nextId(w, 'item'),
      x: 3,
      y: 3,
      resource: 'food' as const,
      foodType: 'raw' as const,
      foodKind: 'staple' as const,
      quantity: 100,
      freshPoints: 83,
      spoiledPoints: 17,
    };
    w.items.push(item);
    pawn.x = 2;
    pawn.y = 3;
    pawn.job = {
      kind: 'separate',
      sourceId: item.id,
      targetId: item.id,
      destination: item,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [item.id],
    };
    const sim = new Simulation(w);
    sim.reservations.claim([item.id], pawn.id);
    const grid = navigationGrid(w);
    for (let i = 0; i < 50 && pawn.job; i++)
      advanceJob(w, pawn, sim.reservations, grid, new Set(), sim.diagnostics);
    const raw = w.items.find((candidate) => candidate.id === item.id);
    const waste = w.items.filter((candidate) => candidate.resource === 'waste');
    expect(raw && freshPoints(raw)).toBe(83);
    expect(raw && spoiledPoints(raw)).toBe(0);
    expect(waste.reduce((total, candidate) => total + candidate.quantity, 0)).toBe(17);
    expect(sim.diagnostics.snapshot().some((event) => event.type === 'FOOD_SEPARATED')).toBe(true);
  });

  it('stacks spoiled food at thirty points and preserves expiry cohorts', () => {
    const w = flatWorld();
    dropWaste(w, { x: 4, y: 4 }, 47);
    expect(
      w.items.filter((item) => item.resource === 'waste').map((item) => item.quantity),
    ).toEqual([30, 17]);
    w.items = [];
    addSpoiledFood(w, { x: 4, y: 4 }, 12, 100);
    addSpoiledFood(w, { x: 4, y: 4 }, 8, 200);
    w.tick = 100;
    advanceWasteDecay(w);
    expect(w.items[0]!.quantity).toBe(8);
    expect(w.items[0]!.expiryBatches).toEqual([{ quantity: 8, expiresAt: 200 }]);
  });

  it('prefers a dump zone and applies bounded sustained rot exposure', () => {
    const w = flatWorld();
    const dump = { x: 6, y: 5 };
    w.dumpZones.push(tileKey(w, dump));
    dropWaste(w, { x: 3, y: 3 }, 5);
    const candidate = workCandidates(w).find((entry) => entry.kind === 'haul');
    expect(candidate?.destination).toEqual(dump);
    const pawn = w.pawns[0]!;
    pawn.x = 3;
    pawn.y = 3;
    for (let i = 0; i < 50; i++) updateNeeds(w, pawn);
    expect(pawn.mood).toBeLessThan(100);
    expect(pawn.rotExposure).toBeLessThanOrEqual(100);
    pawn.x = 10;
    pawn.y = 10;
    for (let i = 0; i < 60; i++) updateNeeds(w, pawn);
    expect(pawn.rotExposure).toBe(0);
  });

  it('separates rot before cooking and resumes the persistent recipe', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    w.dumpZones.push(tileKey(w, { x: 4, y: 5 }));
    w.items.push(
      {
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 100,
        freshPoints: 83,
        spoiledPoints: 17,
      },
      {
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 100,
        freshPoints: 100,
        spoiledPoints: 0,
      },
    );
    const pawn = w.pawns[0]!;
    pawn.x = 6;
    pawn.y = 5;
    pawn.hunger = 25;
    pawn.priorities.cook = 0;
    for (const other of w.pawns.slice(1))
      other.priorities = { plants: 0, build: 0, haul: 0, cook: 0 };
    const sim = new Simulation(w);
    for (let i = 0; i < 1200; i++) sim.step();
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
    expect(
      w.items.some(
        (item) => item.resource === 'waste' && tileKey(w, item) === tileKey(w, { x: 4, y: 5 }),
      ),
    ).toBe(true);
  });

  it('persists Dump zones and fractional spoiled-food batches', () => {
    const w = flatWorld();
    w.dumpZones.push(tileKey(w, { x: 5, y: 5 }));
    addSpoiledFood(w, { x: 5, y: 5 }, 2.5, 1000);
    const saved = encode(w);
    expect(saved.version).toBe(5);
    const loaded = decode(saved).world;
    expect(loaded.dumpZones).toEqual(w.dumpZones);
    expect(loaded.items.find((item) => item.resource === 'waste')?.quantity).toBe(2.5);
    const legacy = JSON.parse(saved.payload);
    delete legacy.dumpZones;
    const migrated = decode({
      ...saved,
      version: 4,
      payload: JSON.stringify(legacy),
      checksum: checksum(JSON.stringify(legacy)),
    }).world;
    expect(migrated.dumpZones).toEqual([]);
  });

  it('cooks one recipe across three source stacks without resetting the station', () => {
    const w = flatWorld();
    const station = { id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' as const };
    w.buildings.push(station);
    const amounts = [44, 38, 30];
    const sourceIds: string[] = [];
    for (const quantity of amounts)
      w.items.push({
        id: (() => {
          const id = nextId(w, 'item');
          sourceIds.push(id);
          return id;
        })(),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity,
        freshPoints: quantity,
        spoiledPoints: 0,
      });
    const pawn = w.pawns[0]!;
    pawn.x = 6;
    pawn.y = 5;
    pawn.hunger = 25;
    pawn.job = {
      kind: 'cook',
      sourceId: w.items[0]!.id,
      targetId: station.id,
      destination: station,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [station.id, w.items[0]!.id],
      amount: 12,
    };
    const sim = new Simulation(w);
    sim.reservations.claim(pawn.job.keys, pawn.id);
    const grid = navigationGrid(w);
    for (let i = 0; i < 1000 && pawn.job; i++)
      advanceJob(w, pawn, sim.reservations, grid, new Set(), sim.diagnostics);
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
    expect(w.items.find((item) => item.foodType === 'meal')?.quantity).toBe(1);
    expect(w.items.find((item) => item.id === sourceIds[2])?.freshPoints).toBe(12);
    expect(sim.reservations.owner(sourceIds[0]!)).toBeUndefined();
    expect(sim.reservations.owner(sourceIds[1]!)).toBeUndefined();
    expect(sim.reservations.owner(station.id)).toBeUndefined();
    expect(sim.diagnostics.snapshot().some((event) => event.type === 'COOK_SOURCE_SWITCHED')).toBe(
      true,
    );
  });

  it('reproduces the live multi-source loop through normal assignment', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    for (const quantity of [44, 38, 30])
      w.items.push({
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity,
        freshPoints: quantity,
        spoiledPoints: 0,
      });
    const pawn = w.pawns[0]!;
    pawn.x = 6;
    pawn.y = 5;
    pawn.hunger = 25;
    pawn.priorities.cook = 0;
    for (const other of w.pawns.slice(1))
      other.priorities = { plants: 0, build: 0, haul: 0, cook: 0 };
    const sim = new Simulation(w);
    for (let i = 0; i < 2000; i++) sim.step();
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
  });

  it('normalizes a tiny fully spoiled raw remainder into expiring waste', () => {
    const w = flatWorld();
    const item = {
      id: nextId(w, 'item'),
      x: 4,
      y: 4,
      resource: 'food' as const,
      foodType: 'raw' as const,
      quantity: 0.15,
      freshPoints: 0,
      spoiledPoints: 0.15,
    };
    w.items.push(item);
    const result = advanceFoodSpoilage(w, item, new Set());
    expect(result?.spoiledFoodCreated).toBeCloseTo(0.15);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.resource).toBe('waste');
    expect(w.items[0]!.quantity).toBeCloseTo(0.15);
    expect(w.items[0]!.expiryBatches?.[0]?.quantity).toBeCloseTo(0.15);
    expect(
      workCandidates({ ...w, dumpZones: [tileKey(w, { x: 6, y: 5 })] }).some(
        (c) => c.sourceId === item.id,
      ),
    ).toBe(false);
  });

  it('keeps a mixed stack below the separation threshold', () => {
    const w = flatWorld();
    const item = {
      id: nextId(w, 'item'),
      x: 4,
      y: 4,
      resource: 'food' as const,
      foodType: 'raw' as const,
      quantity: 40.15,
      freshPoints: 40,
      spoiledPoints: 0.15,
    };
    w.items.push(item);
    advanceFoodSpoilage(w, item, new Set());
    expect(w.items[0]!.resource).toBe('food');
    expect(requiresFoodSeparation(w.items[0]!)).toBe(false);
  });

  it('rejects stale raw haul candidates and exposes normalized waste hauling', () => {
    const w = flatWorld();
    const dump = { x: 6, y: 5 };
    w.dumpZones.push(tileKey(w, dump));
    const item = {
      id: nextId(w, 'item'),
      x: 4,
      y: 4,
      resource: 'food' as const,
      foodType: 'raw' as const,
      quantity: 0.15,
      freshPoints: 0,
      spoiledPoints: 0.15,
    };
    w.items.push(item);
    expect(workCandidates(w).some((candidate) => candidate.sourceId === item.id)).toBe(false);
    advanceFoodSpoilage(w, item, new Set());
    const waste = w.items[0]!;
    expect(waste.resource).toBe('waste');
    expect(workCandidates(w).some((candidate) => candidate.sourceId === waste.id)).toBe(true);
  });

  it('conserves a partial multi-source transaction when explicitly aborted', () => {
    const w = flatWorld();
    const station: Building = { id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' };
    w.buildings.push(station);
    dropWaste(w, { x: 2, y: 2 }, 0.25);
    w.items.push({
      id: nextId(w, 'item'),
      x: 7,
      y: 5,
      resource: 'food',
      foodType: 'raw',
      quantity: 44,
      freshPoints: 44,
      spoiledPoints: 0,
    });
    w.items.push({
      id: nextId(w, 'item'),
      x: 7,
      y: 5,
      resource: 'food',
      foodType: 'raw',
      quantity: 38,
      freshPoints: 38,
      spoiledPoints: 0,
    });
    const pawn = w.pawns[0]!;
    pawn.x = 6;
    pawn.y = 5;
    pawn.job = {
      kind: 'cook',
      sourceId: w.items[1]!.id,
      targetId: station.id,
      destination: station,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [station.id, w.items[1]!.id],
      amount: 12,
    };
    const sim = new Simulation(w);
    sim.reservations.claim(pawn.job.keys, pawn.id);
    const grid = navigationGrid(w);
    for (let i = 0; i < 100; i++) {
      advanceJob(w, pawn, sim.reservations, grid, new Set(), sim.diagnostics);
      if ((station.ingredientFresh ?? 0) >= 12) break;
    }
    const before = resourceTotal(w, 'food') + (station.ingredientFresh ?? 0);
    interruptJob(w, pawn, sim.reservations, sim.diagnostics, 'test abort');
    expect(resourceTotal(w, 'food')).toBeCloseTo(before);
    expect(resourceTotal(w, 'waste')).toBeCloseTo(0.25);
    expect(station.reservedBy).toBeUndefined();
  });

  it('does not report world food items as carried by a pawn', () => {
    const w = flatWorld();
    drop(w, { x: 3, y: 3 }, 'food', 20);
    w.pawns[0]!.carrying = { resource: 'food', quantity: 2, foodType: 'raw' };
    const sim = new Simulation(w);
    const report = buildDebugReport(w, sim.reservations, sim.diagnostics, {}, 1);
    expect(report.items.every((item) => item.carriedBy === null)).toBe(true);
  });

  it('preserves an active recipe buffer across save and load', () => {
    const w = flatWorld();
    const station: Building = { id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' };
    const source = {
      id: nextId(w, 'item'),
      x: 7,
      y: 5,
      resource: 'food' as const,
      foodType: 'raw' as const,
      quantity: 56,
      freshPoints: 56,
      spoiledPoints: 0,
    };
    station.ingredientFresh = 44;
    station.reservedBy = w.pawns[0]!.id;
    w.buildings.push(station);
    w.items.push(source);
    w.pawns[0]!.hunger = 25;
    w.pawns[0]!.job = {
      kind: 'cook',
      sourceId: source.id,
      targetId: station.id,
      destination: station,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [station.id, source.id],
      amount: 12,
      cookTransactionId: 'saved-transaction',
    };
    const loaded = decode(encode(w)).world;
    const foodBeforeLoad =
      resourceTotal(loaded, 'food') + (loaded.buildings[0]!.ingredientFresh ?? 0);
    const sim = new Simulation(loaded);
    const pawn = loaded.pawns[0]!;
    const loadedStation = loaded.buildings.find((building) => building.id === station.id)!;
    const grid = navigationGrid(loaded);
    for (let i = 0; i < 2000 && pawn.job; i++)
      advanceJob(loaded, pawn, sim.reservations, grid, new Set(), sim.diagnostics);
    expect(resourceTotal(loaded, 'food') + (loadedStation.ingredientFresh ?? 0)).toBeCloseTo(
      foodBeforeLoad,
    );
  });

  it('survives a deterministic three-pawn food-pressure scenario', () => {
    const w = flatWorld();
    const dump = { x: 4, y: 5 };
    w.dumpZones.push(tileKey(w, dump));
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    for (const quantity of [40, 40, 40])
      w.items.push({
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity,
        freshPoints: quantity,
        spoiledPoints: 0,
      });
    w.items.push({
      id: nextId(w, 'item'),
      x: 3,
      y: 5,
      resource: 'food',
      foodType: 'raw',
      foodKind: 'staple',
      quantity: 0.2,
      freshPoints: 0,
      spoiledPoints: 0.2,
    });
    const cook = w.pawns[0]!;
    cook.x = 6;
    cook.y = 5;
    cook.hunger = 25;
    cook.priorities.cook = 0;
    for (const pawn of w.pawns.slice(1)) {
      pawn.priorities = { plants: 0, build: 0, haul: 1, cook: 0 };
      pawn.x = 3;
      pawn.y = 5;
    }
    const sim = new Simulation(w);
    for (let i = 0; i < 13000; i++) {
      sim.step();
      if (w.events.some((event) => event.text.includes('prepared a simple meal')))
        cook.priorities.cook = 0;
    }
    const diagnostics = sim.diagnostics.snapshot();
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
    expect(diagnostics.some((event) => event.type === 'COOKING_COMPLETED')).toBe(true);
    expect(diagnostics.some((event) => event.type === 'RAW_FOOD_NORMALIZED_TO_WASTE')).toBe(true);
    expect(
      diagnostics.filter(
        (event) => event.type === 'JOB_INTERRUPTED' && event.reason === 'source amount unavailable',
      ),
    ).toHaveLength(0);
    expect(w.items.filter((item) => item.resource === 'waste')).toHaveLength(0);
  });
});
