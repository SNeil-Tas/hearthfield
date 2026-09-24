import { ensureAgricultureTile } from '../../src/sim/agriculture';
import { describe, expect, it } from 'vitest';
import { advanceJob } from '../../src/sim/jobs';
import { workCandidates } from '../../src/sim/job-board';
import {
  effectiveCarryCapacity,
  depositStack,
  dropFood,
  foodPoints,
  nextId,
  tileKey,
  usefulResourceTotal,
} from '../../src/sim/world';
import { formatResourcePoints } from '../../src/ui/format';
import { flatWorld } from './fixtures';
import { Simulation } from '../../src/sim/simulation';
import { navigationGrid } from '../../src/sim/pathfinding';

describe('v0.5.2 storage throughput', () => {
  it('uses resource-specific carrying capacities', () => {
    expect(effectiveCarryCapacity('food')).toBe(100);
    expect(effectiveCarryCapacity('waste')).toBe(30);
    expect(effectiveCarryCapacity('wood')).toBe(12);
    expect(effectiveCarryCapacity('stone')).toBe(12);
  });

  it('merges compatible food before creating overflow', () => {
    const w = flatWorld();
    const tile = { x: 5, y: 5 };
    w.stockpiles.push(tileKey(w, tile));
    dropFood(w, tile, 60);
    depositStack(w, tile, {
      resource: 'food',
      quantity: 40,
      foodType: 'raw',
      foodKind: 'staple',
      freshPoints: 40,
      spoiledPoints: 0,
    });
    expect(w.items.filter((item) => item.resource === 'food')).toHaveLength(1);
    expect(w.items[0]!.quantity).toBe(100);
    const remaining = depositStack(w, tile, {
      resource: 'food',
      quantity: 50,
      foodType: 'raw',
      foodKind: 'staple',
      freshPoints: 50,
      spoiledPoints: 0,
    });
    expect(w.items.map((item) => item.quantity)).toEqual([100]);
    expect(remaining).toBe(50);
  });

  it('preserves fractional quantities during merges', () => {
    const w = flatWorld();
    const tile = { x: 5, y: 5 };
    w.stockpiles.push(tileKey(w, tile));
    depositStack(w, tile, {
      resource: 'food',
      quantity: 72.4,
      foodType: 'raw',
      foodKind: 'staple',
      freshPoints: 72.4,
      spoiledPoints: 0,
    });
    depositStack(w, tile, {
      resource: 'food',
      quantity: 20.3,
      foodType: 'raw',
      foodKind: 'staple',
      freshPoints: 20.3,
      spoiledPoints: 0,
    });
    expect(w.items[0]!.quantity).toBeCloseTo(92.7);
    expect(w.items[0]!.freshPoints).toBeCloseTo(92.7);
  });

  it('picks only the final recipe remainder from a larger source', () => {
    const w = flatWorld();
    const station = {
      id: nextId(w, 'building'),
      x: 8,
      y: 5,
      kind: 'cooking' as const,
      ingredientFresh: 83,
    };
    w.buildings.push(station);
    const source = {
      id: nextId(w, 'item'),
      x: 7,
      y: 5,
      resource: 'food' as const,
      foodType: 'raw' as const,
      foodKind: 'staple' as const,
      quantity: 50,
      freshPoints: 50,
      spoiledPoints: 0,
    };
    w.items.push(source);
    const pawn = w.pawns[0]!;
    pawn.x = 6;
    pawn.y = 5;
    pawn.job = {
      kind: 'cook',
      sourceId: source.id,
      targetId: station.id,
      destination: station,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [station.id, source.id],
    };
    const sim = new Simulation(w);
    sim.reservations.claim(pawn.job.keys, pawn.id);
    advanceJob(w, pawn, sim.reservations, navigationGrid(w), new Set(), sim.diagnostics);
    expect(pawn.carrying?.quantity).toBe(17);
    expect(w.items[0]!.quantity).toBe(33);
  });

  it('ranks a full distant source above a tiny nearby remnant', () => {
    const w = flatWorld();
    const station = { id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' as const };
    w.buildings.push(station);
    w.items.push(
      {
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 3.5,
        freshPoints: 3.5,
        spoiledPoints: 0,
      },
      {
        id: nextId(w, 'item'),
        x: 3,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 100,
        freshPoints: 100,
        spoiledPoints: 0,
      },
    );
    const candidate = workCandidates(w).find((item) => item.kind === 'cook');
    expect(candidate?.sourceId).toBe(w.items[1]!.id);
  });

  it('offers low-priority consolidation without oscillating', () => {
    const w = flatWorld();
    const tile = { x: 5, y: 5 };
    w.stockpiles.push(tileKey(w, tile), tileKey(w, { x: 6, y: 5 }));
    for (const [x, quantity] of [
      [5, 27],
      [6, 18],
      [5, 42],
      [6, 11],
    ] as const)
      depositStack(
        w,
        { x, y: 5 },
        {
          resource: 'food',
          quantity,
          foodType: 'raw',
          foodKind: 'staple',
          freshPoints: quantity,
          spoiledPoints: 0,
        },
      );
    const sim = new Simulation(w);
    for (let i = 0; i < 90; i++) sim.step();
    expect(
      w.items.filter((item) => item.resource === 'food').reduce((n, item) => n + item.quantity, 0),
    ).toBeCloseTo(98, 3);
    expect(w.items.filter((item) => item.resource === 'food').length).toBeLessThanOrEqual(2);
    const count = w.items.length;
    for (let i = 0; i < 90; i++) sim.step();
    expect(w.items.length).toBeLessThanOrEqual(count);
  });

  it('formats player values without mutating precise simulation values', () => {
    expect(formatResourcePoints(56.83878820857901)).toBe('57');
    expect(formatResourcePoints(0.359)).toBe('<1');
    expect(formatResourcePoints(7.999999999999998)).toBe('8');
    const w = flatWorld();
    dropFood(w, { x: 4, y: 4 }, 20.359);
    expect(w.items[0]!.quantity).toBeCloseTo(20.359);
    expect(formatResourcePoints(usefulResourceTotal(w, 'food'))).toBe('20');
  });

  it('does not count fully spoiled waste as useful Food', () => {
    const w = flatWorld();
    w.items.push({
      id: nextId(w, 'waste'),
      x: 4,
      y: 4,
      resource: 'waste',
      quantity: 30,
      expiryBatches: [{ quantity: 30, expiresAt: 1000 }],
    });
    expect(usefulResourceTotal(w, 'food')).toBe(0);
    expect(foodPoints(w.items[0]!)).toBe(0);
  });

  it('runs a multi-day three-colonist crop, storage and cooking scenario', () => {
    const w = flatWorld();
    const station = { id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' as const };
    w.buildings.push(station);
    w.dumpZones.push(tileKey(w, { x: 10, y: 5 }));
    for (let y = 6; y <= 8; y++)
      for (let x = 2; x <= 4; x++) {
        const key = tileKey(w, { x, y });
        w.growingZones.push(key);
        w.crops.push({ id: nextId(w, 'crop'), x, y, kind: 'grain', growth: 1 });
      }
    for (let y = 6; y <= 8; y++)
      for (let x = 7; x <= 9; x++) w.stockpiles.push(tileKey(w, { x, y }));
    for (const pawn of w.pawns) {
      pawn.priorities = { plants: 1, build: 0, haul: 1, cook: 1 };
      pawn.hunger = 70;
    }
    for (const key of w.growingZones) ensureAgricultureTile(w, key, 'grain');
    const sim = new Simulation(w);
    let cooked = false;
    for (let i = 0; i < 12000; i++) {
      sim.step();
      cooked ||= w.events.some((event) => event.text.includes('prepared a simple meal'));
    }
    expect(w.events.some((event) => event.text.includes('harvested grain'))).toBe(true);
    expect(cooked).toBe(true);
    expect(
      w.items
        .filter((item) => item.resource === 'food' && item.foodType === 'raw')
        .every((item) => item.quantity <= 100 + 1e-6),
    ).toBe(true);
    expect(w.pawns.every((pawn) => pawn.health >= 1)).toBe(true);
    expect(
      sim.diagnostics.snapshot().filter((event) => event.type === 'RESOURCE_PICKUP_AMOUNT').length,
    ).toBeGreaterThan(0);
  });
});
